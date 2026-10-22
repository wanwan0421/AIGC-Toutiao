import { createHash } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ContentStatus as DbContentStatus, Prisma } from "@prisma/client";
import { AssetAuditStatus } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";

export const PublishBlockReason = {
  NotReviewed: "CONTENT_NOT_REVIEWED",
  Rejected: "CONTENT_REJECTED",
  ChangedAfterReview: "CONTENT_CHANGED_AFTER_REVIEW",
  AuditRequired: "AUDIT_REQUIRED_BEFORE_PUBLISH",
  AlreadyPublished: "CONTENT_ALREADY_PUBLISHED",
  Offline: "CONTENT_OFFLINE",
  InvalidStatus: "CONTENT_STATUS_NOT_PUBLISHABLE",
  ImageReviewRequired: "IMAGE_REVIEW_REQUIRED",
  ImageRejected: "IMAGE_REVIEW_REJECTED",
} as const;

// Increment when moderation prompts, risk thresholds, or image review rules change.
export const CONTENT_REVIEW_POLICY_VERSION = "2026-10-21-v1";

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
    asset?: { mimeType: string; auditStatus: AssetAuditStatus; metadata?: Prisma.JsonValue };
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
    const assets = [...(content.assets ?? [])]
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.assetId.localeCompare(right.assetId))
      .map((item) => {
        const metadata = item.asset?.metadata && typeof item.asset.metadata === "object" && !Array.isArray(item.asset.metadata)
          ? item.asset.metadata as Record<string, unknown>
          : {};
        const imageSha256 = typeof metadata.imageSha256 === "string" ? metadata.imageSha256 : null;
        return {
          assetId: item.assetId,
          imageSha256: item.asset?.mimeType.toLowerCase().startsWith("image/") ? imageSha256 : null,
        };
      });

    const payload = {
      title: content.title,
      body: content.body,
      bodyHtml: content.bodyHtml ?? null,
      bodyJson: this.normalizeJson(content.bodyJson ?? null),
      tags: content.tags,
      assets,
      reviewPolicyVersion: CONTENT_REVIEW_POLICY_VERSION,
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

  // 获取当前内容的审核状态
  async getCurrentAuditState(content: ReviewableContent): Promise<CurrentAuditState> {
    const audit = await this.getLatestAuditForContent(content.id);
    return this.evaluateCurrentAudit(content, audit);
  }

  // 评估当前内容的审核状态
  evaluateCurrentAudit(content: ReviewableContent, audit: AuditLike | null): CurrentAuditState {
    const currentHash = this.computeContentReviewHash(content);
    const imageAssets = (content.assets ?? []).filter((item) => item.asset?.mimeType.toLowerCase().startsWith("image/"));
    if (imageAssets.some((item) => item.asset?.auditStatus === AssetAuditStatus.rejected)) {
      return { valid: false, currentHash, reason: PublishBlockReason.ImageRejected };
    }
    if (imageAssets.some((item) => item.asset?.auditStatus !== AssetAuditStatus.approved)) {
      return { valid: false, currentHash, reason: PublishBlockReason.ImageReviewRequired };
    }
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
