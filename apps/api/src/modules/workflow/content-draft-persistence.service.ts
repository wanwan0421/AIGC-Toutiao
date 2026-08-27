import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ContentStatus, ContentVisibility, Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { sanitizeRichText, sanitizeRichTextPayload } from "../../common/rich-text-sanitizer";
import { ContentReviewPolicyService } from "./content-review-policy.service";

export type ContentDraftPersistenceInput = {
  contentId?: string;
  title: string;
  body: string;
  bodyHtml?: string | null;
  bodyJson?: Record<string, unknown> | null;
  tags?: string[];
  assetIds?: string[];
  payload?: Record<string, unknown>;
  clientHash?: string;
};

const persistedContentInclude = {
  author: true,
  assets: { include: { asset: true }, orderBy: { sortOrder: "asc" as const } },
  _count: { select: { comments: true } },
};

@Injectable()
export class ContentDraftPersistenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly reviewPolicy: ContentReviewPolicyService
  ) {}

  async persist(userId: string, input: ContentDraftPersistenceInput) {
    const result = await this.prisma.$transaction((tx) => this.persistInTransaction(tx, userId, input));
    await this.cacheDraft(userId, result.draft);
    return result;
  }

  async persistInTransaction(tx: Prisma.TransactionClient, userId: string, input: ContentDraftPersistenceInput) {
    const assetIds = this.uniqueStrings(input.assetIds ?? []);
    const richText = sanitizeRichText({ html: input.bodyHtml, json: input.bodyJson });
    const payload = input.payload === undefined ? undefined : sanitizeRichTextPayload(input.payload);
    await this.assertOwnedAssets(tx, userId, assetIds);
    const current = input.contentId
      ? await tx.content.findFirst({
          where: { id: input.contentId, authorId: userId },
          include: { assets: { orderBy: { sortOrder: "asc" } } },
        })
      : null;
    if (input.contentId && !current) throw new NotFoundException("content not found");

    const title = input.title.trim() || "未命名草稿";
    const body = input.body ?? "";
    const contentId = current?.id ?? input.contentId;
    let resolvedContentId: string;
    if (current && contentId) {
      const safetySensitiveEdit =
        title !== current.title ||
        body !== current.body ||
        input.bodyHtml !== undefined && richText.html !== current.bodyHtml ||
        input.bodyJson !== undefined && !this.jsonEqual(richText.json ?? null, current.bodyJson) ||
        input.tags !== undefined && JSON.stringify(input.tags) !== JSON.stringify(current.tags) ||
        input.assetIds !== undefined && JSON.stringify(assetIds) !== JSON.stringify(current.assets.map((item) => item.assetId));
      const updated = await tx.content.updateMany({
        where: { id: contentId, authorId: userId },
        data: {
          title,
          body,
          bodyHtml: richText.html,
          bodyJson: this.jsonNullable(richText.json),
          tags: input.tags,
          excerpt: body.slice(0, 72),
          ...(safetySensitiveEdit ? this.reviewPolicy.statusDataForSafetySensitiveEdit(current.status) : {}),
        },
      });
      if (updated.count === 0) throw new NotFoundException("content not found");
      resolvedContentId = contentId;
    } else {
      const created = await tx.content.create({
        data: {
          authorId: userId,
          title,
          body,
          bodyHtml: richText.html ?? null,
          bodyJson: this.jsonNullable(richText.json),
          excerpt: body.slice(0, 72),
          status: ContentStatus.draft,
          visibility: ContentVisibility.public,
          tags: input.tags ?? [],
        },
      });
      resolvedContentId = created.id;
    }

    if (input.assetIds !== undefined) {
      await tx.contentAsset.deleteMany({ where: { contentId: resolvedContentId } });
      if (assetIds.length) {
        await tx.contentAsset.createMany({
          data: assetIds.map((assetId, sortOrder) => ({ contentId: resolvedContentId, assetId, sortOrder })),
          skipDuplicates: true,
        });
      }
    }

    const draft = await tx.draft.upsert({
      where: { contentId: resolvedContentId },
      create: {
        contentId: resolvedContentId,
        authorId: userId,
        title,
        body,
        payload: payload ? (payload as Prisma.InputJsonValue) : undefined,
        clientHash: input.clientHash,
      },
      update: {
        authorId: userId,
        title,
        body,
        payload: payload ? (payload as Prisma.InputJsonValue) : undefined,
        clientHash: input.clientHash,
      },
    });
    const content = await tx.content.findUniqueOrThrow({ where: { id: resolvedContentId }, include: persistedContentInclude });
    return { content, draft };
  }

  async cacheDraft(userId: string, draft: {
    id: string;
    contentId: string;
    authorId: string;
    title: string | null;
    body: string | null;
    payload: Prisma.JsonValue | null;
    clientHash: string | null;
    savedAt: Date;
  }) {
    const payload = { source: "postgres-and-redis", ...this.serializeDraft(draft) };
    await this.redis.getClient().set(this.cacheKey(userId, draft.contentId), JSON.stringify(payload), "EX", 86_400).catch(() => undefined);
    return payload;
  }

  serializeDraft(draft: {
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
      payload: sanitizeRichTextPayload(draft.payload),
      clientHash: draft.clientHash ?? undefined,
      savedAt: draft.savedAt.toISOString(),
    };
  }

  cacheKey(userId: string, contentId: string) {
    return `draft:auto:${userId}:${contentId}`;
  }

  private async assertOwnedAssets(tx: Prisma.TransactionClient, userId: string, assetIds: string[]) {
    if (!assetIds.length) return;
    const count = await tx.asset.count({ where: { uploaderId: userId, id: { in: assetIds } } });
    if (count !== assetIds.length) throw new BadRequestException("one or more assets do not belong to the current user");
  }

  private uniqueStrings(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private jsonNullable(value: Record<string, unknown> | null | undefined) {
    if (value === undefined) return undefined;
    return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
  }

  private jsonEqual(left: unknown, right: unknown) {
    return JSON.stringify(this.normalizeJson(left)) === JSON.stringify(this.normalizeJson(right));
  }

  private normalizeJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.normalizeJson(item));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
          .map(([key, item]) => [key, this.normalizeJson(item)])
      );
    }
    return value;
  }
}
