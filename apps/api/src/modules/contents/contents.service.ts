import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  AuditRiskLevel,
  ContentStatus as ApiContentStatus,
  type AuditResult,
  type ComplianceRewriteResult,
  type ContentVisibility,
  type ContentWorkflowQualityState,
  type ContentWorkflowState,
  type CreateContentCommentRequest,
  type QualityScoreResult,
} from "@aicp/shared";
import {
  ContentReactionType as DbContentReactionType,
  ContentStatus as DbContentStatus,
  ContentVisibility as DbContentVisibility,
  Prisma,
} from "@prisma/client";
import { toContentCommentSummary, toContentDetail, toContentSummary, toDbContentStatus } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { ContentAccessPolicyService } from "./content-access-policy.service";

const contentInclude = {
  author: true,
  assets: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
  _count: { select: { comments: true } },
};

const commentInclude = {
  author: {
    select: {
      id: true,
      accountNo: true,
      nickname: true,
      avatarUrl: true,
    },
  },
};

type ContentWriteBody = {
  title?: string;
  body?: string;
  bodyHtml?: string | null;
  bodyJson?: Record<string, unknown> | null;
  tags?: string[];
  assetIds?: string[];
  visibility?: ContentVisibility;
  scheduledAt?: string | null;
};

function toJsonInput(value: Record<string, unknown> | null | undefined) {
  if (value === undefined) return undefined;
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function toDbContentVisibility(value?: ContentVisibility): DbContentVisibility | undefined {
  if (value === "followers" || value === "private" || value === "public") {
    return value as DbContentVisibility;
  }
  return undefined;
}

function toDateOrNull(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException("invalid scheduledAt");
  }
  return date;
}

@Injectable()
export class ContentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: ContentAccessPolicyService
  ) {}

  async list(userId: string, status?: ApiContentStatus) {
    const items = await this.prisma.content.findMany({
      where: {
        authorId: userId,
        ...(status ? { status: toDbContentStatus(status) } : {}),
      },
      take: 50,
      include: {
        author: {
          select: { id: true, accountNo: true, nickname: true, avatarUrl: true },
        },
        assets: {
          include: { asset: true },
          orderBy: { sortOrder: "asc" as const },
        },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return items.map(toContentSummary);
  }

  async create(userId: string, body: ContentWriteBody) {
    const contentBody = body.body?.trim() ?? "";
    const assetIds = await this.ownedAssetIds(userId, body.assetIds);
    const content = await this.prisma.content.create({
      data: {
        authorId: userId,
        title: body.title?.trim() || "未命名草稿",
        body: contentBody,
        bodyHtml: body.bodyHtml ?? null,
        bodyJson: toJsonInput(body.bodyJson),
        excerpt: contentBody.slice(0, 72),
        status: DbContentStatus.draft,
        visibility: toDbContentVisibility(body.visibility) ?? DbContentVisibility.public,
        scheduledAt: toDateOrNull(body.scheduledAt),
        tags: body.tags ?? [],
        assets: assetIds?.length
          ? {
              createMany: {
                data: assetIds.map((assetId, index) => ({ assetId, sortOrder: index })),
                skipDuplicates: true,
              },
            }
          : undefined,
      },
      include: contentInclude,
    });

    return toContentDetail(content);
  }

  async detail(userId: string, id: string) {
    const content = await this.prisma.content.findUnique({
      where: { id },
      include: contentInclude,
    });

    if (!content) {
      throw new NotFoundException("content not found");
    }

    if (!(await this.accessPolicy.canView(userId, content))) {
      throw new NotFoundException("content not found");
    }

    return {
      ...toContentDetail(content),
      viewerState: await this.viewerState(userId, content.authorId, content.id),
    };
  }

  async listComments(userId: string, id: string, rawLimit?: string | number, cursor?: string) {
    await this.assertContentVisible(userId, id);
    const limit = this.parseLimit(rawLimit, 20);
    const comments = await this.prisma.contentComment.findMany({
      where: { contentId: id },
      include: commentInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    return {
      items: comments.map(toContentCommentSummary),
      nextCursor: comments.length === limit ? comments.at(-1)?.id : undefined,
    };
  }

  async workflowState(userId: string, id: string): Promise<ContentWorkflowState> {
    const content = await this.getContent(userId, id);
    const summary = toContentSummary(content);
    const [auditRecord, qualityRecord] = await Promise.all([
      this.prisma.auditRecord.findFirst({
        where: { contentId: id },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.qualityScore.findFirst({
        where: { contentId: id },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const canPublish = this.canPublishStatus(content.status);

    return {
      content: summary,
      latestAudit: auditRecord
        ? {
            content: summary,
            audit: this.auditResultFromRecord(auditRecord),
            rewrite: this.rewriteFromAuditRecord(auditRecord),
            checkedAt: auditRecord.createdAt.toISOString(),
          }
        : undefined,
      latestQuality: qualityRecord ? this.qualityResultFromRecord(qualityRecord) : undefined,
      canPublish,
      publishBlockReason: canPublish ? undefined : this.publishBlockReason(content.status),
    };
  }

  async createComment(userId: string, id: string, body: CreateContentCommentRequest) {
    await this.assertContentVisible(userId, id);
    const text = body.body?.trim() ?? "";
    if (!text) {
      throw new BadRequestException("comment body is required");
    }
    if (text.length > 1000) {
      throw new BadRequestException("comment body is too long");
    }

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contentComment.create({
        data: {
          contentId: id,
          authorId: userId,
          body: text,
        },
        include: commentInclude,
      });
      await tx.content.update({
        where: { id },
        data: { heatScore: { increment: 1 } },
      });
      await tx.userActionEvent.create({
        data: {
          userId,
          contentId: id,
          eventType: "comment",
        },
      });
      return created;
    });

    return toContentCommentSummary(comment);
  }

  async toggleReaction(userId: string, id: string, type: "like" | "collect") {
    await this.assertContentVisible(userId, id);

    const reactionType = type === "like" ? DbContentReactionType.like : DbContentReactionType.collect;
    const result = await this.prisma.$transaction(async (tx) => {
      const where = {
        userId_contentId_type: {
          userId,
          contentId: id,
          type: reactionType,
        },
      };
      const existing = await tx.contentReaction.findUnique({ where });
      const active = !existing;

      if (existing) {
        await tx.contentReaction.delete({ where });
        if (type === "like") {
          await tx.content.updateMany({ where: { id, likeCount: { gt: 0 } }, data: { likeCount: { decrement: 1 } } });
        } else {
          await tx.content.updateMany({ where: { id, collectCount: { gt: 0 } }, data: { collectCount: { decrement: 1 } } });
        }
        await tx.content.updateMany({ where: { id, heatScore: { gt: 1 } }, data: { heatScore: { decrement: 2 } } });
      } else {
        await tx.contentReaction.create({
          data: {
            userId,
            contentId: id,
            type: reactionType,
          },
        });
        await tx.content.update({
          where: { id },
          data:
            type === "like"
              ? { likeCount: { increment: 1 }, heatScore: { increment: 2 } }
              : { collectCount: { increment: 1 }, heatScore: { increment: 2 } },
        });
      }

      await tx.userActionEvent.create({
        data: {
          userId,
          contentId: id,
          eventType: active ? type : `${type}_cancel`,
        },
      });

      const updated = await tx.content.findUniqueOrThrow({ where: { id } });
      return { active, updated };
    });

    return {
      contentId: id,
      type,
      active: result.active,
      likeCount: result.updated.likeCount,
      collectCount: result.updated.collectCount,
      heatScore: result.updated.heatScore,
    };
  }

  async versions(userId: string, id: string) {
    await this.assertContentExists(userId, id);
    return this.prisma.contentVersion.findMany({
      where: { contentId: id },
      orderBy: { version: "desc" },
    });
  }

  async update(userId: string, id: string, body: ContentWriteBody) {
    const current = await this.getContent(userId, id);
    await this.createVersion(current.id, current.title, current.body, current.bodyHtml, current.bodyJson);

    const nextBody = body.body ?? current.body;
    const data: Prisma.ContentUpdateInput = {
      title: body.title !== undefined ? body.title.trim() || current.title : undefined,
      body: body.body,
      bodyHtml: body.bodyHtml === undefined ? undefined : body.bodyHtml,
      bodyJson: toJsonInput(body.bodyJson),
      excerpt: body.body !== undefined ? nextBody.slice(0, 72) : undefined,
      tags: body.tags,
      visibility: toDbContentVisibility(body.visibility),
      scheduledAt: toDateOrNull(body.scheduledAt),
      status: current.status === DbContentStatus.published ? DbContentStatus.updated : undefined,
    };

    if (body.assetIds !== undefined) {
      const assetIds = (await this.ownedAssetIds(userId, body.assetIds)) ?? [];
      await this.prisma.contentAsset.deleteMany({ where: { contentId: id } });
      if (assetIds.length > 0) {
        await this.prisma.contentAsset.createMany({
          data: assetIds.map((assetId, index) => ({ contentId: id, assetId, sortOrder: index })),
          skipDuplicates: true,
        });
      }
    }

    const updated = await this.prisma.content.update({
      where: { id },
      data,
      include: contentInclude,
    });

    return toContentDetail(updated);
  }

  private async ownedAssetIds(userId: string, assetIds: string[] | undefined) {
    if (assetIds === undefined) return undefined;

    const uniqueIds = Array.from(new Set(assetIds.map((id) => id.trim()).filter(Boolean)));
    if (!uniqueIds.length) return [];

    const assets = await this.prisma.asset.findMany({
      where: { uploaderId: userId, id: { in: uniqueIds } },
      select: { id: true },
    });
    const allowedIds = new Set(assets.map((asset) => asset.id));
    return uniqueIds.filter((id) => allowedIds.has(id));
  }

  async updateVisibility(userId: string, id: string, visibility: ContentVisibility) {
    const current = await this.getContent(userId, id);
    const nextVisibility = toDbContentVisibility(visibility);
    if (!nextVisibility) {
      throw new BadRequestException("invalid visibility");
    }

    const updated = await this.prisma.content.update({
      where: { id: current.id },
      data: { visibility: nextVisibility },
      include: contentInclude,
    });

    return toContentSummary(updated);
  }

  async delete(userId: string, id: string) {
    await this.assertContentExists(userId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.draft.deleteMany({ where: { contentId: id } });
      await tx.contentAsset.deleteMany({ where: { contentId: id } });
      await tx.contentVersion.deleteMany({ where: { contentId: id } });
      await tx.auditRecord.deleteMany({ where: { contentId: id } });
      await tx.qualityScore.deleteMany({ where: { contentId: id } });
      await tx.userActionEvent.deleteMany({ where: { contentId: id } });
      await tx.contentReaction.deleteMany({ where: { contentId: id } });
      await tx.contentComment.deleteMany({ where: { contentId: id } });
      await tx.aiConversation.updateMany({
        where: { contentId: id },
        data: { contentId: null },
      });
      await tx.content.delete({ where: { id } });
    });

    return { ok: true, id };
  }

  async rollback(userId: string, id: string, version: number) {
    const current = await this.getContent(userId, id);
    const target = await this.prisma.contentVersion.findFirst({
      where: { contentId: id, version },
    });
    if (!target) {
      throw new NotFoundException("content version not found");
    }

    await this.createVersion(current.id, current.title, current.body, current.bodyHtml, current.bodyJson);
    const updated = await this.prisma.content.update({
      where: { id },
      data: {
        title: target.title,
        body: target.body,
        bodyHtml: target.bodyHtml,
        bodyJson: toJsonInput(
          target.bodyJson && typeof target.bodyJson === "object" && !Array.isArray(target.bodyJson)
            ? (target.bodyJson as Record<string, unknown>)
            : null
        ),
        excerpt: target.body.slice(0, 72),
        status: current.status === DbContentStatus.published ? DbContentStatus.updated : current.status,
      },
      include: contentInclude,
    });

    return toContentDetail(updated);
  }

  private async getContent(userId: string, id: string) {
    const content = await this.prisma.content.findUnique({
      where: { id },
      include: contentInclude,
    });

    if (!content || content.authorId !== userId) {
      throw new NotFoundException("content not found");
    }

    return content;
  }

  private async assertContentExists(userId: string, id: string) {
    const count = await this.prisma.content.count({ where: { id, authorId: userId } });
    if (count === 0) {
      throw new NotFoundException("content not found");
    }
  }

  private async assertContentVisible(userId: string, id: string) {
    const content = await this.prisma.content.findUnique({
      where: { id },
      select: { authorId: true, status: true, visibility: true },
    });
    if (!content || !(await this.accessPolicy.canView(userId, content))) {
      throw new NotFoundException("content not found");
    }
  }

  private parseLimit(raw: string | number | undefined, fallback: number) {
    const value = Number(raw ?? fallback);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.trunc(value), 1), 50);
  }

  private canPublishStatus(status: DbContentStatus) {
    return (
      status === DbContentStatus.approved ||
      status === DbContentStatus.updated ||
      status === DbContentStatus.pending_review ||
      status === DbContentStatus.scheduled
    );
  }

  private publishBlockReason(status: DbContentStatus) {
    if (status === DbContentStatus.rejected) return "内容安全审核未通过，请先修改后重新审核";
    if (status === DbContentStatus.draft) return "内容需要先通过安全审核后才能发布";
    if (status === DbContentStatus.published) return "内容已经发布";
    if (status === DbContentStatus.offline) return "内容已下线，需要重新编辑审核后发布";
    return "当前状态暂不可发布";
  }

  private auditResultFromRecord(record: {
    passed: boolean;
    riskLevel: string;
    riskTypes: string[];
    reasons: string[];
    rawResponse: Prisma.JsonValue | null;
  }): AuditResult {
    const raw = this.asRecord(record.rawResponse);
    const audit = this.asRecord(raw?.audit);
    if (this.isAuditResult(audit)) {
      return audit;
    }

    return {
      passed: record.passed,
      riskLevel: record.riskLevel as AuditRiskLevel,
      riskTypes: record.riskTypes as AuditResult["riskTypes"],
      reasons: record.reasons,
      rewriteAvailable: !record.passed,
      riskItems: [],
      categoryScores: {},
    };
  }

  private rewriteFromAuditRecord(record: { rawResponse: Prisma.JsonValue | null }) {
    const raw = this.asRecord(record.rawResponse);
    const rewrite = this.asRecord(raw?.rewrite);
    if (!rewrite || typeof rewrite.title !== "string" || typeof rewrite.body !== "string") {
      return null;
    }
    return rewrite as unknown as ComplianceRewriteResult;
  }

  private qualityResultFromRecord(record: {
    total: number;
    dimensions: Prisma.JsonValue;
    reason: string;
    rawResponse: Prisma.JsonValue | null;
    createdAt: Date;
  }): ContentWorkflowQualityState {
    const raw = this.asRecord(record.rawResponse);
    const dimensions = this.asRecord(raw?.dimensions) ?? this.asRecord(record.dimensions);
    const quality: QualityScoreResult = {
      total: typeof raw?.total === "number" ? raw.total : record.total,
      dimensions: {
        structure: this.numberValue(dimensions?.structure),
        clarity: this.numberValue(dimensions?.clarity),
        value: this.numberValue(dimensions?.value),
        attraction: this.numberValue(dimensions?.attraction),
        compliance: this.numberValue(dimensions?.compliance),
      },
      reason: typeof raw?.reason === "string" ? raw.reason : record.reason,
    };

    return {
      ...quality,
      scoredAt: record.createdAt.toISOString(),
    };
  }

  private isAuditResult(value: unknown): value is AuditResult {
    const record = this.asRecord(value);
    return Boolean(
      record &&
        typeof record.passed === "boolean" &&
        typeof record.riskLevel === "string" &&
        Array.isArray(record.riskTypes) &&
        Array.isArray(record.reasons) &&
        Array.isArray(record.riskItems)
    );
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  }

  private numberValue(value: unknown) {
    const number = typeof value === "number" ? value : Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
  }

  private async viewerState(userId: string, authorId: string, contentId: string) {
    const isAuthor = userId === authorId;
    const [like, collect, follow] = await Promise.all([
      this.prisma.contentReaction.findUnique({
        where: {
          userId_contentId_type: {
            userId,
            contentId,
            type: DbContentReactionType.like,
          },
        },
      }),
      this.prisma.contentReaction.findUnique({
        where: {
          userId_contentId_type: {
            userId,
            contentId,
            type: DbContentReactionType.collect,
          },
        },
      }),
      isAuthor
        ? Promise.resolve(null)
        : this.prisma.userFollow.findUnique({
            where: {
              followerId_followingId: {
                followerId: userId,
                followingId: authorId,
              },
            },
          }),
    ]);

    return {
      liked: Boolean(like),
      collected: Boolean(collect),
      followingAuthor: Boolean(follow),
      isAuthor,
    };
  }

  private async createVersion(
    contentId: string,
    title: string,
    body: string,
    bodyHtml?: string | null,
    bodyJson?: Prisma.JsonValue | null
  ) {
    const aggregate = await this.prisma.contentVersion.aggregate({
      where: { contentId },
      _max: { version: true },
    });
    const version = (aggregate._max.version ?? 0) + 1;

    await this.prisma.contentVersion.create({
      data: {
        contentId,
        version,
        title,
        body,
        bodyHtml,
        bodyJson: toJsonInput(
          bodyJson && typeof bodyJson === "object" && !Array.isArray(bodyJson)
            ? (bodyJson as Record<string, unknown>)
            : null
        ),
        snapshot: { title, body, bodyHtml, bodyJson },
      },
    });
  }
}
