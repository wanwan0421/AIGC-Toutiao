import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ContentStatus as ApiContentStatus } from "@aicp/shared";
import { ContentStatus as DbContentStatus, Prisma } from "@prisma/client";
import { buildAuditResult, buildQualityScore } from "../../common/business-rules";
import { toContentDetail, toContentSummary, toDbAuditRiskLevel, toDbContentStatus } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";

const contentInclude = {
  author: true,
  assets: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const }
  }
};

@Injectable()
export class ContentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, status?: ApiContentStatus) {
    const items = await this.prisma.content.findMany({
      where: {
        authorId: userId,
        ...(status ? { status: toDbContentStatus(status) } : {})
      },
      include: contentInclude,
      orderBy: { updatedAt: "desc" }
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
                skipDuplicates: true
              }
            }
          : undefined
      },
      include: contentInclude
    });

    return toContentDetail(content);
  }

  async detail(userId: string, id: string) {
    const content = await this.prisma.content.findUnique({
      where: { id },
      include: contentInclude
    });

    if (!content) {
      throw new NotFoundException("content not found");
    }

    // Allow viewing published content from other users, but own draft/unpublished content
    if (content.status !== DbContentStatus.published && content.authorId !== userId) {
      throw new NotFoundException("content not found");
    }

    return toContentDetail(content);
  }

  async versions(userId: string, id: string) {
    await this.assertContentExists(userId, id);
    return this.prisma.contentVersion.findMany({
      where: { contentId: id },
      orderBy: { version: "desc" }
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
      status: current.status === DbContentStatus.published ? DbContentStatus.updated : undefined
    };

    if (body.assetIds !== undefined) {
      await this.prisma.contentAsset.deleteMany({ where: { contentId: id } });
      if (body.assetIds.length > 0) {
        await this.prisma.contentAsset.createMany({
          data: body.assetIds.map((assetId, index) => ({ contentId: id, assetId, sortOrder: index })),
          skipDuplicates: true
        });
      }
    }

    const updated = await this.prisma.content.update({
      where: { id },
      data,
      include: contentInclude
    });

    return toContentDetail(updated);
  }

  async submitReview(userId: string, id: string) {
    const content = await this.getContent(userId, id);
    const audit = buildAuditResult(content.title, content.body);
    const quality = buildQualityScore(content.title, content.body);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.auditRecord.create({
        data: {
          contentId: id,
          passed: audit.passed,
          riskLevel: toDbAuditRiskLevel(audit.riskLevel),
          riskTypes: audit.riskTypes,
          reasons: audit.reasons,
          rawResponse: audit as unknown as Prisma.InputJsonValue
        }
      });

      await tx.qualityScore.create({
        data: {
          contentId: id,
          total: quality.total,
          dimensions: quality.dimensions as unknown as Prisma.InputJsonValue,
          reason: quality.reason,
          rawResponse: quality as unknown as Prisma.InputJsonValue
        }
      });

      return tx.content.update({
        where: { id },
        data: {
          qualityScore: quality.total,
          status: audit.passed ? DbContentStatus.pending_review : DbContentStatus.rejected
        },
        include: { author: true }
      });
    });

    return {
      content: toContentSummary(updated),
      audit,
      quality
    };
  }

  async approve(userId: string, id: string) {
    const content = await this.getContent(userId, id);
    if (content.status !== DbContentStatus.pending_review) {
      throw new BadRequestException("only pending_review content can be approved");
    }

    const updated = await this.prisma.content.update({
      where: { id },
      data: { status: DbContentStatus.approved },
      include: { author: true }
    });

    return toContentSummary(updated);
  }

  async publish(userId: string, id: string) {
    const content = await this.getContent(userId, id);
    if (content.status !== DbContentStatus.approved && content.status !== DbContentStatus.updated) {
      throw new BadRequestException("content must be approved before publish");
    }

    const updated = await this.prisma.content.update({
      where: { id },
      data: {
        status: DbContentStatus.published,
        publishedAt: new Date()
      },
      include: { author: true }
    });

    return toContentSummary(updated);
  }

  async offline(userId: string, id: string) {
    await this.assertContentExists(userId, id);
    const updated = await this.prisma.content.update({
      where: { id },
      data: { status: DbContentStatus.offline },
      include: { author: true }
    });

    return toContentSummary(updated);
  }

  private async getContent(userId: string, id: string) {
    const content = await this.prisma.content.findUnique({
      where: { id },
      include: contentInclude
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
      _max: { version: true }
    });
    const version = (aggregate._max.version ?? 0) + 1;

    await this.prisma.contentVersion.create({
      data: {
        contentId,
        version,
        title,
        body,
        snapshot: { title, body }
      }
    });
  }
}
