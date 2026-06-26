import { createHash } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ContentStatus as DbContentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";

export const PublishBlockReason = {
  NotReviewed: "CONTENT_NOT_REVIEWED",
  Rejected: "CONTENT_REJECTED",
  ChangedAfterReview: "CONTENT_CHANGED_AFTER_REVIEW",
  AuditRequired: "AUDIT_REQUIRED_BEFORE_PUBLISH",
  AlreadyPublished: "CONTENT_ALREADY_PUBLISHED",
  Offline: "CONTENT_OFFLINE",
  InvalidStatus: "CONTENT_STATUS_NOT_PUBLISHABLE",
} as const;

type PublishBlockReason = (typeof PublishBlockReason)[keyof typeof PublishBlockReason];

type ReviewableContent = {
  id: string;
  title: string;
  body: string;
  bodyHtml?: string | null;
  bodyJson?: Prisma.JsonValue | null;
  tags: string[];
  status: DbContentStatus;
  assets?: Array<{
    assetId: string;
    sortOrder?: number | null;
  }>;
};

type AuditLike = {
  passed: boolean;
  contentHash?: string | null;
};

export type CurrentAuditState = {
  valid: boolean;
  currentHash: string;
  reason?: PublishBlockReason;
};

@Injectable()
export class ContentReviewPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  computeContentReviewHash(content: ReviewableContent) {
    const assetIds = [...(content.assets ?? [])]
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.assetId.localeCompare(right.assetId))
      .map((item) => item.assetId);

    const payload = {
      title: content.title,
      body: content.body,
      bodyHtml: content.bodyHtml ?? null,
      bodyJson: this.normalizeJson(content.bodyJson ?? null),
      tags: content.tags,
      assetIds,
    };

    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  statusDataForSafetySensitiveEdit(status: DbContentStatus): Prisma.ContentUpdateInput {
    if (status === DbContentStatus.published || status === DbContentStatus.updated) {
      return { status: DbContentStatus.updated };
    }

    if (status === DbContentStatus.scheduled) {
      return { status: DbContentStatus.draft, scheduledAt: null };
    }

    return { status: DbContentStatus.draft };
  }

  getLatestAuditForContent(contentId: string) {
    return this.prisma.auditRecord.findFirst({
      where: { contentId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getCurrentAuditState(content: ReviewableContent): Promise<CurrentAuditState> {
    const audit = await this.getLatestAuditForContent(content.id);
    return this.evaluateCurrentAudit(content, audit);
  }

  evaluateCurrentAudit(content: ReviewableContent, audit: AuditLike | null): CurrentAuditState {
    const currentHash = this.computeContentReviewHash(content);
    if (!audit) {
      return { valid: false, currentHash, reason: PublishBlockReason.NotReviewed };
    }
    if (!audit.passed) {
      return { valid: false, currentHash, reason: PublishBlockReason.Rejected };
    }
    if (!audit.contentHash) {
      return { valid: false, currentHash, reason: PublishBlockReason.NotReviewed };
    }
    if (audit.contentHash !== currentHash) {
      return { valid: false, currentHash, reason: PublishBlockReason.ChangedAfterReview };
    }
    return { valid: true, currentHash };
  }

  async getPublishState(content: ReviewableContent) {
    const audit = await this.getLatestAuditForContent(content.id);
    return this.evaluatePublishState(content, audit);
  }

  evaluatePublishState(content: ReviewableContent, audit: AuditLike | null) {
    const statusReason = this.publishStatusBlockReason(content.status);
    if (statusReason) {
      return { canPublish: false, reason: statusReason };
    }

    const auditState = this.evaluateCurrentAudit(content, audit);
    return auditState.valid
      ? { canPublish: true, reason: undefined }
      : { canPublish: false, reason: auditState.reason ?? PublishBlockReason.AuditRequired };
  }

  async assertPublishableForCurrentContent(content: ReviewableContent) {
    const state = await this.getPublishState(content);
    if (!state.canPublish) {
      throw new BadRequestException(state.reason ?? PublishBlockReason.AuditRequired);
    }
  }

  async assertCurrentContentAuditPassed(content: ReviewableContent) {
    const auditState = await this.getCurrentAuditState(content);
    if (!auditState.valid) {
      throw new BadRequestException(auditState.reason ?? PublishBlockReason.AuditRequired);
    }
  }

  private publishStatusBlockReason(status: DbContentStatus): PublishBlockReason | null {
    if (status === DbContentStatus.approved || status === DbContentStatus.updated || status === DbContentStatus.scheduled) {
      return null;
    }
    if (status === DbContentStatus.rejected) return PublishBlockReason.Rejected;
    if (status === DbContentStatus.draft || status === DbContentStatus.pending_review) return PublishBlockReason.AuditRequired;
    if (status === DbContentStatus.published) return PublishBlockReason.AlreadyPublished;
    if (status === DbContentStatus.offline) return PublishBlockReason.Offline;
    return PublishBlockReason.InvalidStatus;
  }

  private normalizeJson(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeJson(item));
    }
    if (value && typeof value === "object" && !(value instanceof Date)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, this.normalizeJson(item)])
      );
    }
    return value;
  }
}
