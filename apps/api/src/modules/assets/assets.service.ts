import { Injectable, NotFoundException } from "@nestjs/common";
import { AssetAuditStatus } from "@prisma/client";
import { DEFAULT_USER_EMAIL } from "../../common/defaults";
import { toAssetSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(contentId?: string) {
    if (!contentId) {
      const items = await this.prisma.asset.findMany({ orderBy: { createdAt: "desc" } });
      return items.map(toAssetSummary);
    }

    const relations = await this.prisma.contentAsset.findMany({
      where: { contentId },
      include: { asset: true },
      orderBy: { sortOrder: "asc" }
    });

    return relations.map((item) => toAssetSummary(item.asset));
  }

  async create(body: { fileName: string; mimeType: string; url: string; contentId?: string }) {
    const uploader = await this.prisma.user.findFirst({ where: { email: DEFAULT_USER_EMAIL } });
    if (!uploader) {
      throw new NotFoundException("default user not found, please run prisma seed first");
    }

    const asset = await this.prisma.asset.create({
      data: {
        uploaderId: uploader.id,
        fileName: body.fileName,
        mimeType: body.mimeType,
        url: body.url,
        auditStatus: this.isSafeMimeType(body.mimeType) ? AssetAuditStatus.approved : AssetAuditStatus.pending
      }
    });

    if (body.contentId) {
      await this.link(asset.id, body.contentId);
    }

    return toAssetSummary(asset);
  }

  async link(id: string, contentId: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException("asset not found");
    }

    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
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
