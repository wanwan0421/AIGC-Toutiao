import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { AiJobDispatchStatus, AiJobStatus as DbAiJobStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AiJobStatus, AiJobType, type AiJobEvent, type AiJobSnapshot } from "@aicp/shared";
import { RedisService } from "../../infra/redis/redis.service";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { WorkflowJobDispatcherService } from "./workflow-job-dispatcher.service";
import { WorkflowJobEventsService } from "./workflow-job-events.service";
import { WorkflowJobQueueService } from "./workflow-job-queue.service";
import { isTerminalJobStatus, toAiJobSnapshot } from "./workflow-job.mapper";

export const AI_JOB_CANCEL_CHANNEL = "ai-job:cancel";

@Injectable()
export class WorkflowJobService {
  private readonly logger = new Logger(WorkflowJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly events: WorkflowJobEventsService,
    private readonly dispatcher: WorkflowJobDispatcherService,
    private readonly queue: WorkflowJobQueueService
  ) {}

  async create(input: {
    userId: string;
    type: `${AiJobType}`;
    payload: Record<string, unknown>;
    contentId?: string;
  }): Promise<AiJobSnapshot> {
    if (!Object.values(AiJobType).includes(input.type as AiJobType)) {
      throw new UnprocessableEntityException("unsupported AI job type");
    }
    if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
      throw new UnprocessableEntityException("AI job payload must be an object");
    }
    const jobId = randomUUID();
    const created = await this.prisma.$transaction(async (tx) => {
      const job = await tx.aiJob.create({
        data: {
          id: jobId,
          userId: input.userId,
          contentId: input.contentId ?? this.contentIdFromPayload(input.payload),
          type: input.type,
          status: DbAiJobStatus.queued,
          input: this.toJson(input.payload),
          dispatch: { create: { status: AiJobDispatchStatus.pending } },
        },
      });
      const snapshot = toAiJobSnapshot(job);
      const event = await this.events.createInTransaction(tx, job.id, {
        type: "snapshot",
        data: { job: snapshot },
      });
      return { snapshot, event };
    });

    await this.events.notify(jobId, created.event);
    await this.dispatcher.dispatchJob(jobId);
    return created.snapshot;
  }

  async get(userId: string, jobId: string) {
    return toAiJobSnapshot(await this.getOwnedJob(userId, jobId));
  }

  async cancel(userId: string, jobId: string, reason = "任务已取消") {
    await this.getOwnedJob(userId, jobId);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.aiJob.updateMany({
        where: {
          id: jobId,
          userId,
          status: { in: [DbAiJobStatus.queued, DbAiJobStatus.running, DbAiJobStatus.awaiting_commit] },
        },
        data: {
          status: DbAiJobStatus.cancelled,
          runToken: null,
          errorMessage: reason,
          errorCode: "JOB_CANCELLED",
          errorRetryable: false,
          cancelRequestedAt: new Date(),
          completedAt: new Date(),
        },
      });
      const job = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      if (changed.count === 0) return { snapshot: toAiJobSnapshot(job), event: null };

      await tx.aiJobDispatch.updateMany({
        where: { jobId, status: { not: AiJobDispatchStatus.dispatched } },
        data: { status: AiJobDispatchStatus.cancelled, lockedUntil: null },
      });
      const snapshot = toAiJobSnapshot(job);
      const event = await this.events.createInTransaction(tx, jobId, {
        type: "error",
        data: { job: snapshot, message: reason, code: "JOB_CANCELLED", retryable: false },
      });
      return { snapshot, event };
    });

    if (outcome.event) {
      await this.queue.removeWaiting(jobId).catch(() => false);
      await this.redisService.getClient().publish(AI_JOB_CANCEL_CHANNEL, JSON.stringify({ jobId, reason })).catch(() => 0);
      await this.events.notify(jobId, outcome.event);
    }
    return outcome.snapshot;
  }

  async *stream(userId: string, jobId: string, lastEventId?: string, signal?: AbortSignal): AsyncGenerator<AiJobEvent> {
    await this.getOwnedJob(userId, jobId);
    let deliveredEventId = /^\d+$/.test(lastEventId?.trim() ?? "") ? lastEventId!.trim() : undefined;
    let deliveredPersistedEvent = false;
    const reader = this.redisService.getClient().duplicate();
    let redisAvailable = false;
    let redisCursor = "$";
    const handleAbort = () => reader.disconnect();
    signal?.addEventListener("abort", handleAbort, { once: true });

    try {
      await reader.connect();
      redisCursor = await this.events.latestStreamId(reader, jobId);
      redisAvailable = true;
    } catch (error) {
      this.logger.debug(`AI job stream uses PostgreSQL polling fallback: ${error instanceof Error ? error.message : String(error)}`);
      reader.disconnect();
    }

    try {
      while (!signal?.aborted) {
        while (true) {
          const replay = await this.events.listAfter(jobId, deliveredEventId);
          if (!replay.length) break;
          for (const event of replay) {
            if (!this.events.isAfter(event.id, deliveredEventId)) continue;
            deliveredPersistedEvent = true;
            deliveredEventId = event.id;
            yield event;
            if (signal?.aborted || event.type === "done" || event.type === "error") return;
          }
          if (replay.length < 500) break;
        }

        const current = await this.getOwnedJob(userId, jobId);
        const snapshot = toAiJobSnapshot(current);
        if (!deliveredPersistedEvent) {
          yield { type: "snapshot", data: { job: snapshot } };
          deliveredPersistedEvent = true;
        }
        if (isTerminalJobStatus(current.status)) {
          yield this.terminalEvent(snapshot);
          return;
        }

        if (redisAvailable) {
          try {
            const read = await this.events.readStream(reader, jobId, redisCursor, 15_000);
            redisCursor = read.cursor;
          } catch (error) {
            this.logger.debug(`AI job Redis wait failed; using PostgreSQL polling: ${error instanceof Error ? error.message : String(error)}`);
            redisAvailable = false;
            reader.disconnect();
          }
        } else {
          await this.delay(3_000, signal);
        }

        if (!signal?.aborted) {
          yield { type: "heartbeat", data: { jobId, at: new Date().toISOString(), redisAvailable } };
        }
      }
    } finally {
      signal?.removeEventListener("abort", handleAbort);
      reader.disconnect();
    }
  }

  private async getOwnedJob(userId: string, jobId: string) {
    const job = await this.prisma.aiJob.findFirst({ where: { id: jobId, userId } });
    if (!job) throw new NotFoundException("AI job not found");
    return job;
  }

  private terminalEvent(job: AiJobSnapshot): AiJobEvent {
    if (job.status === AiJobStatus.Succeeded) {
      return { type: "done", data: { job, result: job.result } };
    }
    return {
      type: "error",
      data: {
        job,
        message: job.errorMessage ?? (job.status === AiJobStatus.Cancelled ? "任务已取消" : "任务失败"),
        code: job.errorCode ?? (job.status === AiJobStatus.Cancelled ? "JOB_CANCELLED" : "AI_JOB_FAILED"),
        retryable: job.errorRetryable,
      },
    };
  }

  private delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const timeout = setTimeout(done, ms);
      const handleAbort = () => done();
      signal?.addEventListener("abort", handleAbort, { once: true });
      function done() {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", handleAbort);
        resolve();
      }
    });
  }

  private contentIdFromPayload(payload: Record<string, unknown>) {
    return typeof payload.contentId === "string" ? payload.contentId : undefined;
  }

  private toJson(value: unknown) {
    return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
  }
}
