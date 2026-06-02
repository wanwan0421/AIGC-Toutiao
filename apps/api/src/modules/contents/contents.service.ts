import { Injectable, NotFoundException } from "@nestjs/common";
import { ContentStatus as ApiContentStatus } from "@aicp/shared";
import { ContentStatus as DbContentStatus, Prisma } from "@prisma/client";
import { toContentDetail, toContentSummary, toDbContentStatus } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";

const contentInclude = {
  author: true,
  assets: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
};

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
      orderBy: { updatedAt: "desc" },
    });

    return items.map(toContentSummary);
  }

  async create(userId: string, body: { title?: string; body?: string; tags?: string[]; assetIds?: string[] }) {
    const contentBody = body.body?.trim() ?? "";
    const content = await this.prisma.content.create({
      data: {
        authorId: userId,
        title: body.title?.trim() || "未命名草稿",
        body: contentBody,
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

    return toContentDetail(content);
  }

  async versions(userId: string, id: string) {
    await this.assertContentExists(userId, id);
    return this.prisma.contentVersion.findMany({
      where: { contentId: id },
      orderBy: { version: "desc" },
    });
  }

  async update(userId: string, id: string, body: { title?: string; body?: string; tags?: string[]; assetIds?: string[] }) {
    const current = await this.getContent(userId, id);
    await this.createVersion(current.id, current.title, current.body);

    const nextBody = body.body ?? current.body;
    const data: Prisma.ContentUpdateInput = {
      title: body.title !== undefined ? body.title.trim() || current.title : undefined,
      body: body.body,
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

    await this.createVersion(current.id, current.title, current.body);
    const updated = await this.prisma.content.update({
      where: { id },
      data: {
        title: target.title,
        body: target.body,
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

  private async createVersion(contentId: string, title: string, body: string) {
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
        snapshot: { title, body },
      },
    });
  }
}
