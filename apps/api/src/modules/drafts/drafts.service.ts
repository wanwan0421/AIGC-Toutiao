import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { sanitizeRichText, sanitizeRichTextPayload } from "../../common/rich-text-sanitizer";
import { ContentDraftPersistenceService } from "../workflow/content-draft-persistence.service";

@Injectable()
export class DraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly persistence: ContentDraftPersistenceService
  ) {}

  async getDraft(userId: string, contentId: string) {
    const cached = await this.redisService.getClient().get(this.persistence.cacheKey(userId, contentId)).catch(() => null);
    if (cached) {
      const parsed = JSON.parse(cached) as Record<string, unknown>;
      return {
        source: "redis",
        ...parsed,
        payload: sanitizeRichTextPayload(parsed.payload),
      };
    }

    const draft = await this.prisma.draft.findUnique({ where: { contentId } });
    if (draft && draft.authorId === userId) {
      return { source: "postgres", ...this.persistence.serializeDraft(draft) };
    }

    const content = await this.prisma.content.findFirst({
      where: { id: contentId, authorId: userId },
      include: { assets: { include: { asset: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!content) throw new NotFoundException("content not found");
    const richText = sanitizeRichText({
      html: content.bodyHtml,
      json: content.bodyJson && typeof content.bodyJson === "object" && !Array.isArray(content.bodyJson)
        ? (content.bodyJson as Record<string, unknown>)
        : null,
    });
    return {
      source: "empty",
      contentId,
      authorId: content.authorId,
      title: content.title,
      body: content.body,
      payload: {
        html: richText.html ?? null,
        json: richText.json ?? null,
        tags: content.tags,
        generatedAssetIds: content.assets.map((item) => item.assetId),
        assetIds: content.assets.map((item) => item.assetId),
        coverPreview: content.assets[0]?.asset.url,
      },
      savedAt: new Date().toISOString(),
    };
  }

  async autosave(
    userId: string,
    contentId: string,
    body: { title?: string; body?: string; payload?: Record<string, unknown>; clientHash?: string }
  ) {
    const content = await this.prisma.content.findFirst({ where: { id: contentId, authorId: userId } });
    if (!content) throw new NotFoundException("content not found");
    const payload = body.payload;
    const result = await this.persistence.persist(userId, {
      contentId,
      title: body.title ?? content.title,
      body: body.body ?? content.body,
      bodyHtml: typeof payload?.html === "string" ? payload.html : undefined,
      bodyJson: this.recordOrNull(payload?.json),
      tags: this.stringArray(payload?.tags),
      assetIds: this.stringArray(payload?.assetIds),
      payload,
      clientHash: body.clientHash,
    });
    return { source: "postgres-and-redis", ...this.persistence.serializeDraft(result.draft) };
  }

  private stringArray(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
  }

  private recordOrNull(value: unknown) {
    if (value === null) return null;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  }
}
