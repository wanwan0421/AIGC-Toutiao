import { Injectable, Logger } from "@nestjs/common";
import { AiJobStatus } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { aiJobConfig } from "./workflow-job.config";
import { WorkflowJobEventsService } from "./workflow-job-events.service";
import { toAiJobSnapshot } from "./workflow-job.mapper";
import { WorkflowJobQueueService } from "./workflow-job-queue.service";

@Injectable()
export class WorkflowJobMaintenanceService {
  private readonly logger = new Logger(WorkflowJobMaintenanceService.name);
  private readonly config = aiJobConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: WorkflowJobEventsService,
    private readonly queue: WorkflowJobQueueService
  ) {}

  async run() {
    const expired = await this.expireAwaitingCommits();
    const deleted = await this.cleanupEvents();
    const [outboxBacklog, awaitingCommit, queueCounts] = await Promise.all([
      this.prisma.aiJobDispatch.count({ where: { status: { in: ["pending", "dispatching"] } } }),
      this.prisma.aiJob.count({ where: { status: AiJobStatus.awaiting_commit } }),
      this.queue.queue.getJobCounts("active", "waiting", "failed", "delayed", "paused").catch(() => ({})),
    ]);
    this.logger.log(`AI job maintenance complete: expired=${expired}, deletedEvents=${deleted}, outboxBacklog=${outboxBacklog}, awaitingCommit=${awaitingCommit}, queue=${JSON.stringify(queueCounts)}`);
    return { expired, deleted, outboxBacklog, awaitingCommit, queueCounts };
  }

  private async expireAwaitingCommits() {
    const cutoff = new Date(Date.now() - this.config.commitTtlDays * 24 * 60 * 60 * 1_000);
    let expired = 0;
    while (true) {
      const jobs = await this.prisma.aiJob.findMany({
        where: { status: AiJobStatus.awaiting_commit, resultReadyAt: { lt: cutoff } },
        orderBy: { resultReadyAt: "asc" },
        take: 100,
      });
      if (!jobs.length) break;
      for (const job of jobs) {
        const outcome = await this.prisma.$transaction(async (tx) => {
          const changed = await tx.aiJob.updateMany({
            where: { id: job.id, status: AiJobStatus.awaiting_commit },
            data: {
              status: AiJobStatus.failed,
              errorMessage: "内容回填等待超过保留期限",
              errorCode: "RESULT_COMMIT_TIMEOUT",
              errorRetryable: false,
              completedAt: new Date(),
            },
          });
          if (changed.count === 0) return null;
          const updated = await tx.aiJob.findUniqueOrThrow({ where: { id: job.id } });
          const event = await this.events.createInTransaction(tx, job.id, {
            type: "error",
            data: { job: toAiJobSnapshot(updated), message: "内容回填等待超过保留期限", code: "RESULT_COMMIT_TIMEOUT", retryable: false },
          });
          return event;
        });
        if (outcome) {
          expired += 1;
          await this.events.notify(job.id, outcome);
        }
      }
      if (jobs.length < 100) break;
    }
    return expired;
  }

  private async cleanupEvents() {
    const cutoff = new Date(Date.now() - this.config.eventRetentionDays * 24 * 60 * 60 * 1_000);
    let deleted = 0;
    while (deleted < this.config.cleanupMaxRows) {
      const take = Math.min(this.config.cleanupBatchSize, this.config.cleanupMaxRows - deleted);
      const rows = await this.prisma.aiJobEvent.findMany({
        where: {
          createdAt: { lt: cutoff },
          job: {
            status: { in: [AiJobStatus.succeeded, AiJobStatus.failed, AiJobStatus.cancelled] },
            completedAt: { lt: cutoff },
          },
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take,
      });
      if (!rows.length) break;
      const result = await this.prisma.aiJobEvent.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
      deleted += result.count;
      if (rows.length < take) break;
    }
    return deleted;
  }
}
