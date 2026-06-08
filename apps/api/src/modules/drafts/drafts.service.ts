import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";

@Injectable()
export class DraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService
  ) {}

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
    const content = await this.prisma.content.findFirst({ where: { id: contentId, authorId: userId } });
    if (!content) {
      throw new NotFoundException("content not found");
    }

    const draft = await this.prisma.draft.upsert({
      where: { contentId },
      create: {
        contentId,
        authorId: content.authorId,
        title: body.title,
        body: body.body,
        payload: body.payload as Prisma.InputJsonValue | undefined,
        clientHash: body.clientHash
      },
      update: {
        authorId: content.authorId,
        title: body.title,
        body: body.body,
        payload: body.payload as Prisma.InputJsonValue | undefined,
        clientHash: body.clientHash
      }
    });

    const assetIds = this.payloadStringArray(body.payload, "assetIds");
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
    return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)));
  }
}
