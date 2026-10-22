import { ContentStatus, ContentVisibility } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ScheduledPublishService } from "./scheduled-publish.service";

const dueAt = new Date("2026-10-13T00:00:00.000Z");

function dueContent(overrides: Record<string, unknown> = {}) {
  return {
    id: "content-1",
    authorId: "author-1",
    title: "旅行计划",
    body: "文".repeat(1001),
    bodyHtml: null,
    bodyJson: null,
    tags: [],
    status: ContentStatus.scheduled,
    visibility: ContentVisibility.public,
    assets: [],
    scheduledAt: dueAt,
    publishedAt: null,
    updatedAt: dueAt,
    ...overrides,
  };
}

describe("ScheduledPublishService article length gate", () => {
  it.each([
    ["26-character title", { title: "题".repeat(26), body: "文".repeat(1000) }],
    ["1001-character body", { title: "题".repeat(25), body: "文".repeat(1001) }],
  ])("returns an over-limit due article to draft without publishing or changing its text: %s", async (_case, overrides) => {
    let stored = dueContent(overrides);
    const originalTitle = stored.title;
    const originalBody = stored.body;
    const content = {
      findMany: vi.fn(async () => [{ id: stored.id }]),
      findFirst: vi.fn(async () => stored),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        stored = { ...stored, ...data };
        return { count: 1 };
      }),
    };
    const auditRecord = { findFirst: vi.fn(async () => ({ passed: true })) };
    const tx = { content, auditRecord };
    const prisma = {
      content,
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const reviewPolicy = {
      evaluatePublishState: vi.fn(() => ({ canPublish: true })),
      statusDataForSafetySensitiveEdit: vi.fn(() => ({ status: ContentStatus.draft, scheduledAt: null })),
    };
    const service = new ScheduledPublishService(prisma as never, reviewPolicy as never);

    await service.publishDueContents();

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(content.updateMany).toHaveBeenCalledOnce();
    expect(content.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: stored.id, status: ContentStatus.scheduled, updatedAt: dueAt }),
      data: { status: ContentStatus.draft, scheduledAt: null },
    }));
    expect(auditRecord.findFirst).not.toHaveBeenCalled();
    expect(reviewPolicy.evaluatePublishState).not.toHaveBeenCalled();
    expect(stored).toMatchObject({
      title: originalTitle,
      body: originalBody,
      status: ContentStatus.draft,
      publishedAt: null,
      scheduledAt: null,
    });
  });
});
