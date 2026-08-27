import { describe, expect, it, vi } from "vitest";
import { AiJobType } from "@aicp/shared";
import { WorkflowJobService } from "./workflow-job.service";

describe("WorkflowJobService", () => {
  it("rejects a content-scoped job before queueing when the article is missing or belongs to another user", async () => {
    const consume = vi.fn(async () => undefined);
    const dispatchJob = vi.fn(async () => true);
    const service = new WorkflowJobService(
      {
        content: { count: vi.fn(async () => 0) },
        aiJob: { findFirst: vi.fn(async () => null) },
      } as never,
      {} as never,
      {} as never,
      { dispatchJob } as never,
      {} as never,
      { parse: vi.fn((_type, payload) => payload) } as never,
      { consume } as never,
      {} as never,
    );

    await expect(service.create({
      userId: "user-1",
      type: AiJobType.CreativeImageGenerate,
      contentId: "content-other",
      payload: { contentId: "content-other", prompt: "cover" },
      idempotencyKey: "request-1",
    })).rejects.toMatchObject({ status: 404 });
    expect(consume).not.toHaveBeenCalled();
    expect(dispatchJob).not.toHaveBeenCalled();
  });

  it("assigns a persisted server fallback when a legacy caller omits its idempotency key", async () => {
    let createdData: Record<string, unknown> | undefined;
    const now = new Date();
    const prisma = {
      aiJob: {
        findFirst: vi.fn(async () => null),
        count: vi.fn(async () => 0),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
        aiJob: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            createdData = data;
            return {
              id: data.id,
              userId: data.userId,
              contentId: null,
              conversationId: null,
              assistantMessageId: null,
              type: data.type,
              status: "queued",
              progress: 0,
              currentStep: null,
              input: data.input,
              result: null,
              errorMessage: null,
              errorCode: null,
              errorRetryable: false,
              warnings: [],
              attempts: 0,
              startedAt: null,
              resultReadyAt: null,
              appliedAt: null,
              appliedEventId: null,
              completedAt: null,
              createdAt: now,
              updatedAt: now,
            };
          }),
        },
      })),
    };
    const events = {
      createInTransaction: vi.fn(async () => ({ id: "1", type: "snapshot", data: {} })),
      notify: vi.fn(async () => undefined),
    };
    const dispatcher = { dispatchJob: vi.fn(async () => true) };
    const service = new WorkflowJobService(
      prisma as never,
      {} as never,
      events as never,
      dispatcher as never,
      {} as never,
      { parse: vi.fn((_type, payload) => payload) } as never,
      { consume: vi.fn(async () => undefined) } as never,
      {} as never,
    );

    await service.create({
      userId: "user-1",
      type: AiJobType.CreativeImageGenerate,
      payload: { prompt: "cover" },
    });

    expect(createdData?.idempotencyKey).toMatch(/^server:[0-9a-f-]{36}$/);
    expect(dispatcher.dispatchJob).toHaveBeenCalledOnce();
  });
});
