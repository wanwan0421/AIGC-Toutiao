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
    };
    const updateMany = vi.fn(async (_args: { data: Record<string, unknown> }) => ({ count: 1 }));
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
  });
});
