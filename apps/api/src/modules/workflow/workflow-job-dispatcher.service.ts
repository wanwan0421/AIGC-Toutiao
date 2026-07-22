import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AiJobDispatchStatus } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { aiJobConfig } from "./workflow-job.config";
import { WorkflowJobQueueService } from "./workflow-job-queue.service";

type ClaimedDispatch = { id: string; jobId: string; attempts: number };

@Injectable()
export class WorkflowJobDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowJobDispatcherService.name);
  private readonly config = aiJobConfig();
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: WorkflowJobQueueService
  ) {}

  onModuleInit() {
    this.schedule(0);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async dispatchJob(jobId: string) {
    try {
      await this.jobs.enqueue(jobId);
      await this.prisma.aiJobDispatch.updateMany({
        where: { jobId, status: { not: AiJobDispatchStatus.cancelled } },
        data: { status: AiJobDispatchStatus.dispatched, lockedUntil: null, lastError: null },
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = await this.prisma.aiJobDispatch.findUnique({ where: { jobId }, select: { attempts: true } }).catch(() => null);
      const retryDelay = Math.min(this.config.outboxPollMs * 2 ** Math.max(0, (current?.attempts ?? 1) - 1), 5 * 60_000);
      await this.prisma.aiJobDispatch.updateMany({
        where: { jobId, status: { not: AiJobDispatchStatus.cancelled } },
        data: {
          status: AiJobDispatchStatus.pending,
          lockedUntil: null,
          lastError: message.slice(0, 1_000),
          nextAttemptAt: new Date(Date.now() + retryDelay),
        },
      }).catch(() => undefined);
      this.logger.debug(`AI job ${jobId} remains in outbox: ${message}`);
      return false;
    }
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref?.();
  }

  private async tick() {
    if (this.running || this.stopped) return this.schedule(this.config.outboxPollMs);
    this.running = true;
    try {
      const claimed = await this.claim(20);
      for (const dispatch of claimed) {
        await this.dispatchJob(dispatch.jobId);
      }
    } catch (error) {
      this.logger.debug(`AI job outbox poll skipped: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
      this.schedule(this.config.outboxPollMs);
    }
  }

  private claim(limit: number) {
    return this.prisma.$queryRaw<ClaimedDispatch[]>`
      WITH picked AS (
        SELECT "id"
        FROM "AiJobDispatch"
        WHERE (
          "status" = 'pending'::"AiJobDispatchStatus"
          OR ("status" = 'dispatching'::"AiJobDispatchStatus" AND "lockedUntil" < NOW())
        )
          AND "nextAttemptAt" <= NOW()
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "AiJobDispatch" AS dispatch
      SET "status" = 'dispatching'::"AiJobDispatchStatus",
          "attempts" = dispatch."attempts" + 1,
          "lockedUntil" = NOW() + INTERVAL '30 seconds',
          "updatedAt" = NOW()
      FROM picked
      WHERE dispatch."id" = picked."id"
      RETURNING dispatch."id", dispatch."jobId", dispatch."attempts"
    `;
  }
}
