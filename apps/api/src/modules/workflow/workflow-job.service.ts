import { Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AiJobStatus, AiJobEvent, AiJobSnapshot, AiJobType } from "@aicp/shared";
import { RedisService } from "../../infra/redis/redis.service";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { WorkflowJobEventsService } from "./workflow-job-events.service";
import { WorkflowJobRunner } from "./workflow-job.runner";
import { isTerminalJobStatus, toAiJobSnapshot, type AiJobRecord } from "./workflow-job.mapper";

type AiJobDelegate = {
  create(args: unknown): Promise<AiJobRecord>;
  update(args: unknown): Promise<AiJobRecord>;
  updateMany(args: unknown): Promise<unknown>;
  findUnique(args: unknown): Promise<AiJobRecord | null>;
  findFirst(args: unknown): Promise<AiJobRecord | null>;
  findMany(args: unknown): Promise<AiJobRecord[]>;
};

@Injectable()
export class WorkflowJobService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly events: WorkflowJobEventsService,
    private readonly runner: WorkflowJobRunner
  ) {}

  async onModuleInit() {
    await this.recoverPendingJobs();
  }

  async create(input: {
    userId: string;
    type: `${AiJobType}`;
    payload: Record<string, unknown>;
    contentId?: string;
  }): Promise<AiJobSnapshot> {
    const job = await this.aiJobs.create({
      data: {
        userId: input.userId,
        contentId: input.contentId ?? this.contentIdFromPayload(input.payload),
        type: input.type,
        input: this.toJson(input.payload),
      },
    });

    const snapshot = toAiJobSnapshot(job);
    setTimeout(() => void this.runner.run(job.id), 0);
    return snapshot;
  }

  async get(userId: string, jobId: string) {
    return toAiJobSnapshot(await this.getOwnedJob(userId, jobId));
  }

  async cancel(userId: string, jobId: string) {
    const job = await this.getOwnedJob(userId, jobId);
    if (isTerminalJobStatus(job.status)) {
      return toAiJobSnapshot(job);
    }

    const updated = await this.aiJobs.update({
      where: { id: jobId },
      data: {
        status: AiJobStatus.Cancelled,
        errorMessage: "任务已取消",
        completedAt: new Date(),
      },
    });
    const snapshot = toAiJobSnapshot(updated);
    await this.events.publish(jobId, { type: "error", data: { job: snapshot, message: "任务已取消" } });
    return snapshot;
  }

  async *stream(userId: string, jobId: string): AsyncGenerator<AiJobEvent> {
    const initial = await this.getOwnedJob(userId, jobId);
    const initialSnapshot = toAiJobSnapshot(initial);
    yield { type: "snapshot", data: { job: initialSnapshot } };
    if (isTerminalJobStatus(initial.status)) {
      yield this.terminalEvent(initialSnapshot);
      return;
    }

    const queue: AiJobEvent[] = [];
    let notify: (() => void) | undefined;
    const push = (event: AiJobEvent) => {
      queue.push(event);
      notify?.();
      notify = undefined;
    };
    const wait = () =>
      new Promise<void>((resolve) => {
        notify = resolve;
      });

    const subscriber = this.redisService.getClient().duplicate();
    let redisSubscribed = false;
    try {
      await subscriber.connect();
      await subscriber.subscribe(this.events.channel(jobId));
      subscriber.on("message", (_channel: string, message: string) => {
        try {
          push(JSON.parse(message) as AiJobEvent);
        } catch {
          // Ignore malformed event payloads from the realtime channel.
        }
      });
      redisSubscribed = true;
    } catch (error: unknown) {
      this.logger.debug(`AI job SSE uses DB polling fallback: ${(error as Error).message}`);
      subscriber.disconnect();
    }

    // SSE 断线不会取消任务；这里定期读取 DB 快照，也兜底 Redis 丢失事件。
    const interval = setInterval(() => {
      void this.pushPolledSnapshot(userId, jobId, push);
      push({ type: "heartbeat", data: { jobId, at: new Date().toISOString(), redisSubscribed } });
    }, redisSubscribed ? 15000 : 3000);

    try {
      while (true) {
        if (!queue.length) {
          await wait();
        }
        const event = queue.shift();
        if (!event) continue;
        yield event;
        if (event.type === "done" || event.type === "error") break;
      }
    } finally {
      clearInterval(interval);
      if (redisSubscribed) {
        await subscriber.unsubscribe(this.events.channel(jobId)).catch(() => undefined);
      }
      subscriber.disconnect();
    }
  }

  private async recoverPendingJobs() {
    await this.aiJobs
      .updateMany({
        where: { status: AiJobStatus.Running },
        data: { status: AiJobStatus.Queued, currentStep: "等待恢复" },
      })
      .catch((error: unknown) => {
        this.logger.warn(`AI job recovery skipped: ${(error as Error).message}`);
      });

    const jobs = await this.aiJobs
      .findMany({
        where: { status: AiJobStatus.Queued },
        orderBy: { createdAt: "asc" },
        take: 20,
      })
      .catch(() => []);

    for (const job of jobs) {
      setTimeout(() => void this.runner.run(job.id), 0);
    }
  }

  private async pushPolledSnapshot(userId: string, jobId: string, push: (event: AiJobEvent) => void) {
    const job = await this.aiJobs.findFirst({ where: { id: jobId, userId } }).catch(() => null);
    if (!job) return;
    const snapshot = toAiJobSnapshot(job);
    push({ type: "snapshot", data: { job: snapshot } });
    if (isTerminalJobStatus(job.status)) {
      push(this.terminalEvent(snapshot));
    }
  }

  private async getOwnedJob(userId: string, jobId: string) {
    const job = await this.aiJobs.findFirst({ where: { id: jobId, userId } });
    if (!job) {
      throw new NotFoundException("AI job not found");
    }
    return job;
  }

  private terminalEvent(job: AiJobSnapshot): AiJobEvent {
    if (job.status === "succeeded") {
      return { type: "done", data: { job, result: job.result } };
    }
    return {
      type: "error",
      data: { job, message: job.errorMessage ?? (job.status === AiJobStatus.Cancelled ? "任务已取消" : "任务失败") },
    };
  }

  private get aiJobs(): AiJobDelegate {
    return (this.prisma as unknown as { aiJob: AiJobDelegate }).aiJob;
  }

  private contentIdFromPayload(payload: Record<string, unknown>) {
    return typeof payload.contentId === "string" ? payload.contentId : undefined;
  }

  private toJson(value: unknown) {
    return JSON.parse(JSON.stringify(value ?? {}));
  }
}
