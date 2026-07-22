import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { aiJobConfig, AI_JOB_NAME } from "./workflow-job.config";

export type AiJobQueueData = { jobId: string };

@Injectable()
export class WorkflowJobQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkflowJobQueueService.name);
  private readonly config = aiJobConfig();
  private readonly connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    // Commands still fail fast while Redis is unavailable, but the shared
    // connection keeps probing so a pending Outbox record can recover without
    // restarting the API process.
    retryStrategy: (attempt) => Math.min(250 * attempt, 5_000),
  });
  readonly queue = new Queue<AiJobQueueData>(this.config.queueName, { connection: this.connection });

  constructor() {
    this.connection.on("error", (error) => this.logger.debug(`AI job queue Redis error: ${error.message}`));
  }

  async enqueue(jobId: string) {
    return this.queue.add(
      AI_JOB_NAME,
      { jobId },
      {
        jobId,
        attempts: this.config.attempts,
        backoff: { type: "exponential", delay: this.config.backoffMs },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 5_000 },
      }
    );
  }

  async removeWaiting(jobId: string) {
    const job = await this.queue.getJob(jobId).catch(() => undefined);
    if (!job) return false;
    const state = await job.getState().catch(() => "unknown");
    if (state !== "waiting" && state !== "delayed" && state !== "paused" && state !== "prioritized") return false;
    await job.remove();
    return true;
  }

  async onModuleDestroy() {
    await this.queue.close().catch(() => undefined);
    this.connection.disconnect();
  }
}
