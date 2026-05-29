import { Injectable, NotFoundException } from "@nestjs/common";
import { AssetAuditStatus } from "@prisma/client";
import { toAssetSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, contentId?: string) {
    if (!contentId) {
      const items = await this.prisma.asset.findMany({ where: { uploaderId: userId }, orderBy: { createdAt: "desc" } });
      return items.map(toAssetSummary);
    }

    const relations = await this.prisma.contentAsset.findMany({
      where: { contentId, content: { authorId: userId } },
      include: { asset: true },
      orderBy: { sortOrder: "asc" }
    });

    return relations.map((item) => toAssetSummary(item.asset));
  }

  async create(userId: string, body: { fileName: string; mimeType: string; url: string; contentId?: string }) {
    const asset = await this.prisma.asset.create({
      data: {
        uploaderId: userId,
        fileName: body.fileName,
        mimeType: body.mimeType,
        url: body.url,
        auditStatus: this.isSafeMimeType(body.mimeType) ? AssetAuditStatus.approved : AssetAuditStatus.pending
      }
    });

    if (body.contentId) {
      await this.link(userId, asset.id, body.contentId);
    }

    return toAssetSummary(asset);
  }

  async link(userId: string, id: string, contentId: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, uploaderId: userId } });
    if (!asset) {
      throw new NotFoundException("asset not found");
    }

    const content = await this.prisma.content.findFirst({ where: { id: contentId, authorId: userId } });
    if (!content) {
      throw new NotFoundException("content not found");
    }

    await this.prisma.contentAsset.upsert({
      where: { contentId_assetId: { contentId, assetId: id } },
      create: { contentId, assetId: id },
      update: {}
    });

    return {
      ok: true,
      contentId,
      asset: toAssetSummary(asset)
    };
  }

  private isSafeMimeType(mimeType: string) {
    return ["image/jpeg", "image/png", "image/webp", "text/plain"].includes(mimeType);
  }
}
