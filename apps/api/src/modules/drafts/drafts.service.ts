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

  async getDraft(contentId: string) {
    const cacheKey = this.cacheKey(contentId);
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

    if (draft) {
      return {
        source: "postgres",
        ...this.serializeDraft(draft)
      };
    }

    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      throw new NotFoundException("content not found");
    }

    return {
      source: "empty",
      contentId,
      authorId: content.authorId,
      title: content.title,
      body: content.body,
      savedAt: new Date().toISOString()
    };
  }

  async autosave(contentId: string, body: { title?: string; body?: string; payload?: Record<string, unknown>; clientHash?: string }) {
    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
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

    const payload = {
      source: "postgres-and-redis",
      ...this.serializeDraft(draft)
    };

    await this.redisService.getClient().set(this.cacheKey(contentId), JSON.stringify(payload), "EX", 60 * 60 * 24).catch(() => undefined);

    return payload;
  }

  private cacheKey(contentId: string) {
    return `draft:auto:${contentId}`;
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
}
