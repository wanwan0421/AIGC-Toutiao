import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { ContentReviewPolicyService } from "../workflow/content-review-policy.service";

@Injectable()
export class DraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly reviewPolicy: ContentReviewPolicyService
  ) {}

  // 获取草稿时，优先从 Redis 获取，如果 Redis 没有，再从 PostgreSQL 获取，并将结果写入 Redis 以供下次快速访问。
  async getDraft(userId: string, contentId: string) {
    const cacheKey = this.cacheKey(userId, contentId);
    const cached = await this.redisService
      .getClient()
      .get(cacheKey)
      .catch(() => null);

    if (cached) {
      return {
        source: "redis",
        ...(JSON.parse(cached) as Record<string, unknown>)
      };
    }

    const draft = await this.prisma.draft.findUnique({
      where: { contentId }
    });

    if (draft && draft.authorId === userId) {
      return {
        source: "postgres",
        ...this.serializeDraft(draft)
      };
    }

    const content = await this.prisma.content.findFirst({
      where: { id: contentId, authorId: userId },
      include: {
        assets: {
          include: { asset: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!content) {
      throw new NotFoundException("content not found");
    }

    return {
      source: "empty",
      contentId,
      authorId: content.authorId,
      title: content.title,
      body: content.body,
      payload: {
        html: content.bodyHtml,
        json: content.bodyJson,
        tags: content.tags,
        generatedAssetIds: content.assets.map((item) => item.assetId),
        coverPreview: content.assets[0]?.asset.url,
      },
      savedAt: new Date().toISOString()
    };
  }

  async autosave(userId: string, contentId: string, body: { title?: string; body?: string; payload?: Record<string, unknown>; clientHash?: string }) {
    const content = await this.prisma.content.findFirst({
      where: { id: contentId, authorId: userId },
      include: {
        assets: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!content) {
      throw new NotFoundException("content not found");
    }
    const sanitizedPayload = await this.sanitizePayload(userId, body.payload);
    const assetIds = this.payloadStringArray(sanitizedPayload, "assetIds");
    const safetySensitiveEdit =
      (body.title !== undefined && body.title !== content.title) ||
      (body.body !== undefined && body.body !== content.body) ||
      (assetIds !== null && !this.sameStringArray(assetIds, content.assets.map((item) => item.assetId)));

    const dataToUpdateInContent: Prisma.ContentUpdateInput = {};
    if (body.title !== undefined) {
      dataToUpdateInContent.title = body.title;
    }
    if (body.body !== undefined) {
      dataToUpdateInContent.body = body.body;
    }
    if (safetySensitiveEdit) {
      Object.assign(dataToUpdateInContent, this.reviewPolicy.statusDataForSafetySensitiveEdit(content.status));
    }
    if (Object.keys(dataToUpdateInContent).length > 0) {
      await this.prisma.content.update({
        where: { id: contentId },
        data: dataToUpdateInContent,
      });
    }

    const draft = await this.prisma.draft.upsert({
      where: { contentId },
      create: {
        contentId,
        authorId: content.authorId,
        title: body.title,
        body: body.body,
        payload: sanitizedPayload as Prisma.InputJsonValue | undefined,
        clientHash: body.clientHash
      },
      update: {
        authorId: content.authorId,
        title: body.title,
        body: body.body,
        payload: sanitizedPayload as Prisma.InputJsonValue | undefined,
        clientHash: body.clientHash
      }
    });

    if (assetIds) {
      await this.prisma.$transaction(async (tx) => {
        await tx.contentAsset.deleteMany({ where: { contentId } });
        if (assetIds.length) {
          await tx.contentAsset.createMany({
            data: assetIds.map((assetId, index) => ({ contentId, assetId, sortOrder: index })),
            skipDuplicates: true,
          });
        }
      });
    }

    const payload = {
      source: "postgres-and-redis",
      ...this.serializeDraft(draft)
    };

    await this.redisService.getClient().set(this.cacheKey(userId, contentId), JSON.stringify(payload), "EX", 60 * 60 * 24).catch(() => undefined);

    return payload;
  }

  private async sanitizePayload(userId: string, payload: Record<string, unknown> | undefined) {
    const assetIds = this.payloadStringArray(payload, "assetIds");
    const coverAssetId = typeof payload?.coverAssetId === "string" ? payload.coverAssetId.trim() : "";
    if (!payload || (!assetIds && !coverAssetId)) return payload;

    const idsToCheck = Array.from(new Set([...(assetIds ?? []), coverAssetId].filter(Boolean)));
    const assets = idsToCheck.length
      ? await this.prisma.asset.findMany({
          where: { uploaderId: userId, id: { in: idsToCheck } },
          select: { id: true },
        })
      : [];
    const allowedIds = new Set(assets.map((asset) => asset.id));
    const nextAssetIds = assetIds ? assetIds.filter((id) => allowedIds.has(id)) : undefined;
    const nextCoverAssetId = coverAssetId && allowedIds.has(coverAssetId) ? coverAssetId : undefined;

    return {
      ...payload,
      ...(nextAssetIds ? { assetIds: nextAssetIds } : {}),
      ...(coverAssetId ? { coverAssetId: nextCoverAssetId ?? null } : {}),
    };
  }

  private cacheKey(userId: string, contentId: string) {
    return `draft:auto:${userId}:${contentId}`;
  }

  private serializeDraft(draft: {
    id: string;
    contentId: string;
    authorId: string;
    title: string | null;
    body: string | null;
    payload: Prisma.JsonValue | null;
    clientHash: string | null;
    savedAt: Date;
  }) {
    return {
      id: draft.id,
      contentId: draft.contentId,
      authorId: draft.authorId,
      title: draft.title ?? undefined,
      body: draft.body ?? undefined,
      payload: draft.payload,
      clientHash: draft.clientHash ?? undefined,
      savedAt: draft.savedAt.toISOString()
    };
  }

  private payloadStringArray(payload: Record<string, unknown> | undefined, key: string) {
    const value = payload?.[key];
    if (!Array.isArray(value)) return null;
    return Array.from(new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)));
  }

  private sameStringArray(left: string[], right: string[]) {
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }
}
