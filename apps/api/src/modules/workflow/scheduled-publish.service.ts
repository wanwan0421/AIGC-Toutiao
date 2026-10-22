import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { ContentStatus as DbContentStatus } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { ContentReviewPolicyService } from "./content-review-policy.service";
import { validateArticleText } from "../../common/article-length-policy";
import { AppError } from "../../common/app-error";
import { WritingSkillService } from "../ai/writing-skill.service";

const POLL_INTERVAL_MS = 60_000;

@Injectable()
export class ScheduledPublishService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledPublishService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewPolicy: ContentReviewPolicyService,
    @Optional() private readonly writingSkill?: WritingSkillService
  ) {}

  onModuleInit() {
    if (process.env.AI_JOB_PROCESS_ROLE === "worker") return;
    this.timer = setInterval(() => void this.publishDueContents(), POLL_INTERVAL_MS);
    void this.publishDueContents();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async publishDueContents() {
    if (this.running) return;
    this.running = true;
    try {
      const dueContents = await this.prisma.content.findMany({
        where: { status: DbContentStatus.scheduled, scheduledAt: { lte: new Date() } },
        select: { id: true },
        take: 50,
        orderBy: { scheduledAt: "asc" },
      });
      for (const due of dueContents) {
        const now = new Date();
        try {
          const outcome = await this.prisma.$transaction(async (tx) => {
            const content = await tx.content.findFirst({
              where: { id: due.id, status: DbContentStatus.scheduled, scheduledAt: { lte: now } },
              include: { assets: { include: { asset: true }, orderBy: { sortOrder: "asc" } } },
            });
            if (!content) return { state: "changed" as const };

            let blockReason: string | null = null;
            try {
              validateArticleText({
                title: content.title,
                body: content.body,
                bodyHtml: content.bodyHtml,
                bodyJson: content.bodyJson && typeof content.bodyJson === "object" && !Array.isArray(content.bodyJson)
                  ? content.bodyJson as Record<string, unknown> : null,
              });
            } catch (error) {
              if (!(error instanceof AppError) || error.statusCode !== 422) throw error;
              blockReason = (error as Error).message;
            }
            if (!blockReason) {
              const audit = await tx.auditRecord.findFirst({
                where: { contentId: content.id },
                orderBy: { createdAt: "desc" },
              });
              const state = this.reviewPolicy.evaluatePublishState(content, audit);
              if (!state.canPublish) blockReason = state.reason ?? "AUDIT_REQUIRED_BEFORE_PUBLISH";
            }
            if (blockReason) {
              await tx.content.updateMany({
                where: { id: content.id, status: DbContentStatus.scheduled, updatedAt: content.updatedAt },
                data: this.reviewPolicy.statusDataForSafetySensitiveEdit(DbContentStatus.scheduled),
              });
              return { state: "blocked" as const, reason: blockReason };
            }
            const changed = await tx.content.updateMany({
              where: {
                id: content.id,
                status: DbContentStatus.scheduled,
                scheduledAt: { lte: now },
                updatedAt: content.updatedAt,
              },
              data: { status: DbContentStatus.published, publishedAt: now, scheduledAt: null },
            });
            if (changed.count === 1) {
              const published = await tx.content.findUniqueOrThrow({ where: { id: content.id } });
              await this.writingSkill?.syncPublishedContent(tx, published);
            }
            return { state: changed.count === 1 ? "published" as const : "changed" as const };
          });
          if (outcome.state === "blocked") {
            this.logger.warn(`Scheduled publish blocked for ${due.id}: ${outcome.reason}`);
          }
        } catch (error) {
          this.logger.warn(`Scheduled publish skipped for ${due.id}: ${(error as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
