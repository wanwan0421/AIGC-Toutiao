import { describe, expect, it, vi } from "vitest";
import { AiJobStatus, AiJobType } from "@aicp/shared";
import { WorkflowJobResultCommitService } from "./workflow-job-result-commit.service";

describe("WorkflowJobResultCommitService conversation reply", () => {
  it("commits the draft and one final assistant reply atomically, including on a repeated commit", async () => {
    const now = new Date("2026-10-24T00:00:00.000Z");
    const content = {
      id: "content-1", title: "厦门旅行", body: "正文", tags: [], assets: [],
      status: "draft", visibility: "public", author: { id: "user-1", nickname: "作者" },
      qualityScore: null, heatScore: 0, viewCount: 0, likeCount: 0, collectCount: 0,
      createdAt: now, updatedAt: now, publishedAt: null, scheduledAt: null,
    };
    const job = {
      id: "job-1", userId: "user-1", type: AiJobType.CreativeDirectGenerate,
      status: AiJobStatus.AwaitingCommit, contentId: null, conversationId: "conversation-1", assistantMessageId: "assistant-1",
      input: {}, result: { title: "厦门旅行" }, progress: 95, currentStep: "等待保存",
      errorMessage: null, errorCode: null, errorRetryable: false, warnings: [], attempts: 1,
      startedAt: now, resultReadyAt: now, appliedAt: null, appliedEventId: null,
      appliedPayloadHash: null, completedAt: null, createdAt: now, updatedAt: now,
    };
    const createMessage = vi.fn(async () => ({ id: "message-1" }));
    const attachConversation = vi.fn(async () => ({ count: 1 }));
    const tx = {
      aiJob: {
        findFirst: vi.fn(async () => job),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(job, data);
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn(async () => job),
      },
      aiJobEvent: { findFirst: vi.fn(async () => ({ id: 1n })) },
      aiConversation: { updateMany: attachConversation },
      aiMessage: { create: createMessage },
      content: { findUniqueOrThrow: vi.fn(async () => content) },
    };
    const prisma = {
      aiJob: { findFirst: vi.fn(async () => job) },
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const persistence = { persistInTransaction: vi.fn(async () => ({ content, draft: null })) };
    const events = {
      createInTransaction: vi.fn(async () => ({ id: 2n, type: "done" })),
      notify: vi.fn(async () => undefined),
    };
    const service = new WorkflowJobResultCommitService(prisma as never, persistence as never, events as never);
    const request = { resultEventId: "1", content: { title: "厦门旅行", body: "正文", tags: [], assetIds: [], payload: {} } };

    await service.commit("user-1", "job-1", request);
    await service.commit("user-1", "job-1", request);

    expect(persistence.persistInTransaction).toHaveBeenCalledTimes(1);
    expect(attachConversation).toHaveBeenCalledWith({ where: { id: "conversation-1", userId: "user-1" }, data: { contentId: "content-1" } });
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(createMessage).toHaveBeenCalledWith({ data: expect.objectContaining({
      conversationId: "conversation-1",
      dedupeKey: "creative-direct-generate:job-1:terminal",
      content: "图文已生成，正文和配图已回填。",
    }) });
  });
});
