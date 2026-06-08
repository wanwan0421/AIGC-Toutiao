import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ContentStatus as ApiContentStatus, type CreateContentCommentRequest } from "@aicp/shared";
import { ContentReactionType as DbContentReactionType, ContentStatus as DbContentStatus, Prisma } from "@prisma/client";
import { toContentCommentSummary, toContentDetail, toContentSummary, toDbContentStatus } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";

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
};

function toJsonInput(value: Record<string, unknown> | null | undefined) {
  if (value === undefined) return undefined;
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

@Injectable()
export class ContentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, status?: ApiContentStatus) {
    const items = await this.prisma.content.findMany({
      where: {
        authorId: userId,
        ...(status ? { status: toDbContentStatus(status) } : {}),
      },
      include: contentInclude,
      orderBy: { createdAt: "desc" },
    });

    return items.map(toContentSummary);
  }

  async create(userId: string, body: ContentWriteBody) {
    const contentBody = body.body?.trim() ?? "";
    const content = await this.prisma.content.create({
      data: {
        authorId: userId,
        title: body.title?.trim() || "未命名草稿",
        body: contentBody,
        bodyHtml: body.bodyHtml ?? null,
        bodyJson: toJsonInput(body.bodyJson),
        excerpt: contentBody.slice(0, 72),
        status: DbContentStatus.draft,
        tags: body.tags ?? [],
        assets: body.assetIds?.length
          ? {
              createMany: {
                data: body.assetIds.map((assetId, index) => ({ assetId, sortOrder: index })),
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

    if (content.status !== DbContentStatus.published && content.authorId !== userId) {
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
    const content = await this.prisma.content.findUnique({ where: { id } });
    if (!content || (content.status !== DbContentStatus.published && content.authorId !== userId)) {
      throw new NotFoundException("content not found");
    }

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
      status: current.status === DbContentStatus.published ? DbContentStatus.updated : undefined,
    };

    if (body.assetIds !== undefined) {
      await this.prisma.contentAsset.deleteMany({ where: { contentId: id } });
      if (body.assetIds.length > 0) {
        await this.prisma.contentAsset.createMany({
          data: body.assetIds.map((assetId, index) => ({ contentId: id, assetId, sortOrder: index })),
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
      select: { authorId: true, status: true },
    });
    if (!content || (content.status !== DbContentStatus.published && content.authorId !== userId)) {
      throw new NotFoundException("content not found");
    }
  }

  private parseLimit(raw: string | number | undefined, fallback: number) {
    const value = Number(raw ?? fallback);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.trunc(value), 1), 50);
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
