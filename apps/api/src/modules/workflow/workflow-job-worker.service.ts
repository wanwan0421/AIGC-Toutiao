import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import Redis from "ioredis";
import { createServer, type Server } from "node:http";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { AI_JOB_CANCEL_CHANNEL } from "./workflow-job.service";
import { aiJobConfig, AI_JOB_MAINTENANCE_NAME, AI_JOB_NAME } from "./workflow-job.config";
import { type AiJobQueueData, WorkflowJobQueueService } from "./workflow-job-queue.service";
import { WorkflowJobMaintenanceService } from "./workflow-job-maintenance.service";
import { WorkflowJobRunner } from "./workflow-job.runner";

@Injectable()
export class WorkflowJobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowJobWorkerService.name);
  private readonly config = aiJobConfig();
  private readonly activeJobIds = new Set<string>();
  private worker?: Worker<AiJobQueueData>;
  private connection?: Redis;
  private subscriber?: Redis;
  private cancelTimer?: NodeJS.Timeout;
  private healthServer?: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: WorkflowJobQueueService,
    private readonly runner: WorkflowJobRunner,
    private readonly maintenance: WorkflowJobMaintenanceService
  ) {}

  async onModuleInit() {
    if (process.env.AI_JOB_PROCESS_ROLE !== "worker") return;
    await this.start();
  }

  async start() {
    if (this.worker) return;
    await this.prisma.$queryRaw`SELECT 1`;
    this.connection = this.redisConnection();
    await this.connection.connect();
    await this.connection.ping();
    this.worker = new Worker<AiJobQueueData>(
      this.config.queueName,
      (job, _token, signal) => this.process(job, signal),
      { connection: this.connection, concurrency: this.config.workerConcurrency }
    );
    this.worker.on("error", (error) => this.logger.error(`AI job worker error: ${error.message}`, error.stack));
    this.worker.on("stalled", (jobId) => this.logger.warn(`AI job stalled: ${jobId}`));
    await this.startCancellationSubscriber();
    this.cancelTimer = setInterval(() => void this.pollCancelledJobs(), this.config.cancelPollMs);
    this.cancelTimer.unref?.();
    await this.queue.queue.upsertJobScheduler(
      "ai-job-maintenance-daily",
      { every: 24 * 60 * 60 * 1_000 },
      {
        name: AI_JOB_MAINTENANCE_NAME,
        data: { jobId: "maintenance" },
        opts: {
          attempts: this.config.attempts,
          backoff: { type: "exponential", delay: this.config.backoffMs },
          removeOnComplete: { count: 1_000 },
          removeOnFail: { count: 5_000 },
        },
      }
    );
    this.startHealthServer();
    this.logger.log(`AI job worker ready: queue=${this.config.queueName}, concurrency=${this.config.workerConcurrency}`);
  }

  async onModuleDestroy() {
    if (this.cancelTimer) clearInterval(this.cancelTimer);
    await new Promise<void>((resolve) => this.healthServer?.close(() => resolve()) ?? resolve());
    await this.worker?.close().catch(() => undefined);
    this.subscriber?.disconnect();
    this.connection?.disconnect();
  }

  private async process(job: Job<AiJobQueueData>, signal?: AbortSignal) {
    if (job.name === AI_JOB_MAINTENANCE_NAME) return this.maintenance.run();
    if (job.name !== AI_JOB_NAME || !job.data.jobId) return;
    const jobId = job.data.jobId;
    this.activeJobIds.add(jobId);
    try {
      return await this.runner.run(jobId, {
        signal,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? this.config.attempts,
      });
    } finally {
      this.activeJobIds.delete(jobId);
    }
  }

  private async startCancellationSubscriber() {
    this.subscriber = this.redisConnection();
    await this.subscriber.connect();
    await this.subscriber.subscribe(AI_JOB_CANCEL_CHANNEL);
    this.subscriber.on("message", (_channel, raw) => {
      try {
        const message = JSON.parse(raw) as { jobId?: string; reason?: string };
        if (message.jobId && this.activeJobIds.has(message.jobId)) {
          this.worker?.cancelJob(message.jobId, message.reason ?? "AI task was cancelled");
        }
      } catch {
        // Ignore malformed best-effort cancellation notifications.
      }
    });
  }

  private async pollCancelledJobs() {
    if (!this.worker || !this.activeJobIds.size) return;
    const cancelled = await this.prisma.aiJob.findMany({
      where: { id: { in: [...this.activeJobIds] }, status: "cancelled" },
      select: { id: true, errorMessage: true, cancelRequestedAt: true },
    }).catch(() => []);
    for (const job of cancelled) {
      if (job.cancelRequestedAt) this.logger.log(`AI job cancellation latency ${job.id}: ${Date.now() - job.cancelRequestedAt.getTime()}ms`);
      this.worker.cancelJob(job.id, job.errorMessage ?? "AI task was cancelled");
    }
  }

  private redisConnection() {
    const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    connection.on("error", (error) => this.logger.debug(`Worker Redis error: ${error.message}`));
    return connection;
  }

  private startHealthServer() {
    const port = Number(process.env.WORKER_HEALTH_PORT ?? 3002);
    this.healthServer = createServer(async (request, response) => {
      if (request.url !== "/ready") {
        response.writeHead(404).end();
        return;
      }
      try {
        await Promise.all([this.prisma.$queryRaw`SELECT 1`, this.connection?.ping()]);
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      } catch {
        response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false }));
      }
    });
    this.healthServer.listen(port, "0.0.0.0");
  }
}
