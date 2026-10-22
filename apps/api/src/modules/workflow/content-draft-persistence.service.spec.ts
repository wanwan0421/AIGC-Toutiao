import { ContentStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ContentDraftPersistenceService } from "./content-draft-persistence.service";

describe("ContentDraftPersistenceService", () => {
  it("does not invalidate an approval when jsonb only changed object key order", async () => {
    const current = {
      id: "content-1",
      authorId: "user-1",
      title: "Title",
      body: "Body",
      bodyHtml: null,
      bodyJson: {
        content: [{ content: [{ text: "Body", type: "text" }], type: "paragraph" }],
        type: "doc",
      },
      tags: [],
      assets: [],
      status: ContentStatus.approved,
      updatedAt: new Date("2026-10-14T00:00:00.000Z"),
    };
    const updateMany = vi.fn(async (_args: { data: Record<string, unknown>; where: Record<string, unknown> }) => ({ count: 1 }));
    const statusDataForSafetySensitiveEdit = vi.fn(() => ({ status: ContentStatus.draft }));
    const tx = {
      content: {
        findFirst: vi.fn(async () => current),
        updateMany,
        findUniqueOrThrow: vi.fn(async () => current),
      },
      contentAsset: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      draft: {
        upsert: vi.fn(async () => ({
          id: "draft-1",
          contentId: current.id,
          authorId: current.authorId,
          title: current.title,
          body: current.body,
          payload: null,
          clientHash: null,
          savedAt: new Date(),
        })),
      },
      asset: { count: vi.fn(async () => 0) },
    };
    const service = new ContentDraftPersistenceService(
      {} as never,
      {} as never,
      { statusDataForSafetySensitiveEdit } as never
    );

    await service.persistInTransaction(tx as never, current.authorId, {
      contentId: current.id,
      title: current.title,
      body: current.body,
      bodyJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
      },
    });

    expect(statusDataForSafetySensitiveEdit).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty("status");
    expect(updateMany.mock.calls[0]?.[0]?.where).toMatchObject({ updatedAt: current.updatedAt });
  });

  it("clears stale rich text when a plain-text autosave replaces the body", async () => {
    const current = {
      id: "content-1", authorId: "user-1", title: "Title", body: "Old",
      bodyHtml: "<p>Old</p>",
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Old" }] }] },
      tags: [], assets: [], status: ContentStatus.approved, updatedAt: new Date(),
    };
    const updateMany = vi.fn(async (_args: { data: Record<string, unknown> }) => ({ count: 1 }));
    const tx = {
      content: { findFirst: vi.fn(async () => current), updateMany, findUniqueOrThrow: vi.fn(async () => current) },
      contentAsset: { deleteMany: vi.fn(), createMany: vi.fn() },
      draft: { upsert: vi.fn(async () => ({ id: "draft-1" })) },
      asset: { count: vi.fn(async () => 0) },
    };
    const service = new ContentDraftPersistenceService(
      {} as never, {} as never,
      { statusDataForSafetySensitiveEdit: vi.fn(() => ({ status: ContentStatus.draft })) } as never
    );

    await service.persistInTransaction(tx as never, current.authorId, {
      contentId: current.id, title: current.title, body: "New",
    });

    expect(updateMany.mock.calls[0]?.[0]?.data).toMatchObject({ body: "New", bodyHtml: null, status: ContentStatus.draft });
    expect(updateMany.mock.calls[0]?.[0]?.data.bodyJson).toBeDefined();
  });

  it("rejects an overlong autosave before changing content or draft", async () => {
    const current = {
      id: "content-1", authorId: "user-1", title: "Title", body: "Old",
      bodyHtml: null, bodyJson: null, tags: [], assets: [], status: ContentStatus.draft, updatedAt: new Date(),
    };
    const tx = {
      content: { findFirst: vi.fn(async () => current), updateMany: vi.fn() },
      draft: { upsert: vi.fn() }, asset: { count: vi.fn(async () => 0) },
    };
    const service = new ContentDraftPersistenceService({} as never, {} as never, {} as never);

    await expect(service.persistInTransaction(tx as never, current.authorId, {
      contentId: current.id, title: current.title, body: "新".repeat(1001),
    })).rejects.toMatchObject({ code: "ARTICLE_LENGTH_EXCEEDED", statusCode: 422 });
    expect(tx.content.updateMany).not.toHaveBeenCalled();
    expect(tx.draft.upsert).not.toHaveBeenCalled();
  });

  it("fills omitted title and body from the content read inside the transaction", async () => {
    const current = {
      id: "content-1", authorId: "user-1", title: "Concurrent title", body: "Concurrent body",
      bodyHtml: "<p>Concurrent body</p>", bodyJson: null,
      tags: [], assets: [], status: ContentStatus.approved, updatedAt: new Date(),
    };
    const updateMany = vi.fn(async (_args: { data: Record<string, unknown> }) => ({ count: 1 }));
    const tx = {
      content: { findFirst: vi.fn(async () => current), updateMany, findUniqueOrThrow: vi.fn(async () => current) },
      draft: { upsert: vi.fn(async () => ({ id: "draft-1" })) }, asset: { count: vi.fn(async () => 0) },
    };
    const reviewPolicy = { statusDataForSafetySensitiveEdit: vi.fn() };
    const service = new ContentDraftPersistenceService({} as never, {} as never, reviewPolicy as never);

    await service.persistInTransaction(tx as never, current.authorId, { contentId: current.id });

    expect(updateMany.mock.calls[0]?.[0]?.data).toMatchObject({
      title: "Concurrent title", body: "Concurrent body", bodyHtml: "<p>Concurrent body</p>",
    });
    expect(reviewPolicy.statusDataForSafetySensitiveEdit).not.toHaveBeenCalled();
  });

  it("derives a new body when autosave supplies only rich text", async () => {
    const current = {
      id: "content-1", authorId: "user-1", title: "Title", body: "Old",
      bodyHtml: "<p>Old</p>", bodyJson: null,
      tags: [], assets: [], status: ContentStatus.draft, updatedAt: new Date(),
    };
    const updateMany = vi.fn(async (_args: { data: Record<string, unknown> }) => ({ count: 1 }));
    const tx = {
      content: { findFirst: vi.fn(async () => current), updateMany, findUniqueOrThrow: vi.fn(async () => current) },
      draft: { upsert: vi.fn(async () => ({ id: "draft-1" })) },
      asset: { count: vi.fn(async () => 0) },
    };
    const service = new ContentDraftPersistenceService(
      {} as never, {} as never,
      { statusDataForSafetySensitiveEdit: vi.fn(() => ({ status: ContentStatus.draft })) } as never
    );

    await service.persistInTransaction(tx as never, current.authorId, {
      contentId: current.id, bodyHtml: "<p>New</p>",
    });

    expect(updateMany.mock.calls[0]?.[0]?.data).toMatchObject({ body: "New", bodyHtml: "<p>New</p>" });
  });
});
