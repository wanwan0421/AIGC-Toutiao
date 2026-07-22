import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError, combineAbortSignals, throwIfAborted } from "../../common/app-error";
import { WorkflowJobDispatcherService } from "./workflow-job-dispatcher.service";
import { WorkflowJobEventsService } from "./workflow-job-events.service";
import { aiJobConfig } from "./workflow-job.config";
import { WorkflowJobRunner } from "./workflow-job.runner";
import { ModelClientService } from "../ai/model-client.service";
import { ImageGenerationService } from "../ai/image-generation.service";
import { StorageService } from "../storage/storage.service";
import { WorkflowJobMaintenanceService } from "./workflow-job-maintenance.service";

describe("AI job reliability primitives", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.AI_JOB_ATTEMPTS;
    delete process.env.ARK_API_KEY;
    delete process.env.ARK_MODEL_ID;
    delete process.env.ARK_IMAGE_API_KEY;
    delete process.env.ARK_IMAGE_MODEL_ID;
  });

  it("uses the documented retry defaults and accepts configuration overrides", () => {
    expect(aiJobConfig().attempts).toBe(3);
    process.env.AI_JOB_ATTEMPTS = "5";
    expect(aiJobConfig().attempts).toBe(5);
  });

  it("propagates a structured cancellation reason through combined signals", () => {
    const user = new AbortController();
    const timeout = new AbortController();
    const signal = combineAbortSignals([user.signal, timeout.signal]);
    user.abort(new AppError({ code: "JOB_CANCELLED", message: "cancelled", statusCode: 409, retryable: false }));
    expect(() => throwIfAborted(signal)).toThrowError(expect.objectContaining({ code: "JOB_CANCELLED", retryable: false }));
  });

  it("passes task cancellation to the active upstream fetch", async () => {
    process.env.ARK_API_KEY = "test-key";
    process.env.ARK_MODEL_ID = "test-model";
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        receivedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }));
    const model = new ModelClientService();
    const controller = new AbortController();
    const request = model.complete({ messages: [{ role: "user", content: "hello" }], signal: controller.signal });
    await Promise.resolve();
    expect(receivedSignal).toBeDefined();
    controller.abort(new AppError({ code: "JOB_CANCELLED", message: "cancelled", statusCode: 409, retryable: false }));
    await expect(request).rejects.toMatchObject({ code: "JOB_CANCELLED", retryable: false });
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("passes task cancellation to an active image-generation request", async () => {
    process.env.ARK_IMAGE_API_KEY = "test-key";
    process.env.ARK_IMAGE_MODEL_ID = "test-model";
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const service = new ImageGenerationService({} as never, {} as never);
    const controller = new AbortController();
    const request = service.generateSingleImage({ userId: "user-1", prompt: "cover", signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: "JOB_CANCELLED", retryable: false });
  });

  it("passes task cancellation to an active remote-file download", async () => {
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const service = new StorageService({} as never);
    const controller = new AbortController();
    const request = service.saveRemoteFile("https://example.test/image.png", {}, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: "JOB_CANCELLED", retryable: false });
  });

  it("persists an event before publishing the Redis wake-up", async () => {
    const order: string[] = [];
    const prisma = {
      aiJobEvent: {
        create: vi.fn(async () => {
          order.push("postgres");
          return { id: 42n };
        }),
      },
    };
    const redis = {
      xadd: vi.fn(async () => {
        order.push("redis");
        return "1-0";
      }),
      expire: vi.fn(async () => 1),
    };
    const service = new WorkflowJobEventsService(prisma as never, { getClient: () => redis } as never);
    const event = await service.publish("job-1", { type: "progress", data: { progress: 20 } });
    expect(event.id).toBe("42");
    expect(order).toEqual(["postgres", "redis"]);
  });

  it("returns a failed dispatch to the outbox with a future retry time", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      aiJobDispatch: {
        findUnique: vi.fn(async () => ({ attempts: 2 })),
        updateMany: vi.fn(async (args: Record<string, unknown>) => {
          updates.push(args);
          return { count: 1 };
        }),
      },
    };
    const dispatcher = new WorkflowJobDispatcherService(
      prisma as never,
      { enqueue: vi.fn(async () => { throw new Error("redis unavailable"); }) } as never
    );
    expect(await dispatcher.dispatchJob("job-1")).toBe(false);
    const data = updates.at(-1)?.data as { status: string; nextAttemptAt: Date };
    expect(data.status).toBe("pending");
    expect(data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    dispatcher.onModuleDestroy();
  });

  it("does not create a terminal event when the runToken CAS loses to cancellation", async () => {
    const createEvent = vi.fn();
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
        aiJob: {
          updateMany: vi.fn(async () => ({ count: 0 })),
          findUniqueOrThrow: vi.fn(),
        },
      })),
    };
    const runner = new WorkflowJobRunner(
      prisma as never,
      { createInTransaction: createEvent, notify: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const result = await (runner as unknown as {
      terminalUpdate: (...args: unknown[]) => Promise<unknown>;
    }).terminalUpdate("job-1", "stale-token", { status: "succeeded" }, "done", () => ({}));
    expect(result).toBeNull();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("does not create a partial event when cancellation wins the row-lock CAS", async () => {
    const createEvent = vi.fn();
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
        aiJob: { updateMany: vi.fn(async () => ({ count: 0 })) },
      })),
    };
    const runner = new WorkflowJobRunner(
      prisma as never,
      { createInTransaction: createEvent, notify: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    await expect((runner as unknown as {
      activeEvent: (...args: unknown[]) => Promise<unknown>;
    }).activeEvent("job-1", "stale-token", "partial", { kind: "draft" }))
      .rejects.toMatchObject({ code: "JOB_CANCELLED" });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("cleans only events selected by the terminal-job retention query in bounded batches", async () => {
    const eventFindMany = vi.fn()
      .mockResolvedValueOnce([{ id: 10n }, { id: 11n }])
      .mockResolvedValueOnce([]);
    const prisma = {
      aiJob: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
      aiJobDispatch: { count: vi.fn(async () => 0) },
      aiJobEvent: {
        findMany: eventFindMany,
        deleteMany: vi.fn(async () => ({ count: 2 })),
      },
    };
    const maintenance = new WorkflowJobMaintenanceService(
      prisma as never,
      {} as never,
      { queue: { getJobCounts: vi.fn(async () => ({ active: 0, waiting: 0, failed: 0 })) } } as never
    );
    const result = await maintenance.run();
    expect(result.deleted).toBe(2);
    expect(eventFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { job: { status: { in: ["succeeded", "failed", "cancelled"] } } },
      take: 1000,
    });
  });
});
