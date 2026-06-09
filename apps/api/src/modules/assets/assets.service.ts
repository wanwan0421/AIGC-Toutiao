import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AssetAuditStatus } from "@prisma/client";
import { toAssetSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { ModelClientService } from "../ai/model-client.service";
import { SafetyRuleEngine } from "../ai/safety/safety-rule-engine.service";
import { StorageService } from "../storage/storage.service";
import { ImageModerationService } from "./image-moderation.service";

type UploadFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const TEXT_MIME_TYPES = ["text/plain", "text/markdown"];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_TEXT_SIZE = 2 * 1024 * 1024;

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly imageModeration: ImageModerationService,
    private readonly modelClient: ModelClientService,
    private readonly safetyRuleEngine: SafetyRuleEngine,
  ) {}

  async list(userId: string, contentId?: string) {
    if (!contentId) {
      const items = await this.prisma.asset.findMany({
        where: { uploaderId: userId },
        orderBy: { createdAt: "desc" },
      });
      return items.map(toAssetSummary);
    }

    const relations = await this.prisma.contentAsset.findMany({
      where: { contentId, content: { authorId: userId } },
      include: { asset: true },
      orderBy: { sortOrder: "asc" },
    });

    return relations.map((item) => toAssetSummary(item.asset));
  }

  async listAllPendingAudit() {
    const items = await this.prisma.asset.findMany({
      where: { auditStatus: AssetAuditStatus.pending },
      orderBy: { createdAt: "desc" },
    });
    return items.map(toAssetSummary);
  }

  async batchReauditAllPending() {
    const pendingAssets = await this.prisma.asset.findMany({
      where: { auditStatus: AssetAuditStatus.pending },
      orderBy: { createdAt: "asc" },
    });

    let successCount = 0;
    let rejectCount = 0;

    for (const asset of pendingAssets) {
      try {
        const scanText = `${asset.fileName}`;
        const safetyResult = this.safetyRuleEngine.scan({
          title: scanText,
          body: "",
        });

        const blockingRisks = safetyResult.riskItems.filter(
          (item) => item.severity === "medium" || item.severity === "high",
        );

        if (blockingRisks.length > 0) {
          await this.prisma.asset.update({
            where: { id: asset.id },
            data: {
              auditStatus: AssetAuditStatus.rejected,
              auditReason: `历史重审命中敏感词：${blockingRisks.map((r) => r.reason).join("；")}`,
              riskLevel: safetyResult.riskLevel,
              riskTypes: safetyResult.riskTypes,
            },
          });
          rejectCount += 1;
        } else {
          await this.prisma.asset.update({
            where: { id: asset.id },
            data: {
              auditStatus: AssetAuditStatus.approved,
              auditReason: "历史重审通过",
              riskLevel: "low",
              riskTypes: [],
            },
          });
          successCount += 1;
        }
      } catch (error) {
        this.logger.warn(`Re-audit asset ${asset.id} skipped: ${(error as Error).message}`);
      }
    }

    return {
      total: pendingAssets.length,
      success: successCount,
      rejected: rejectCount,
    };
  }

  async create(userId: string, body: { fileName: string; mimeType: string; url: string; contentId?: string }) {
    const safeName = this.normalizeFileName(body.fileName);
    const audit = await this.auditAssetInput({
      fileName: safeName,
      mimeType: body.mimeType,
    });

    if (audit.auditStatus === AssetAuditStatus.rejected) {
      throw new BadRequestException(audit.auditReason ?? "素材合规校验不通过");
    }

    const asset = await this.prisma.asset.create({
      data: {
        uploaderId: userId,
        fileName: safeName,
        mimeType: body.mimeType,
        url: body.url,
        auditStatus: audit.auditStatus,
        auditReason: audit.auditReason,
        riskLevel: audit.riskLevel,
        riskTypes: audit.riskTypes,
      },
    });

    if (body.contentId) {
      await this.link(userId, asset.id, body.contentId);
    }

    return toAssetSummary(asset);
  }

  async upload(userId: string, file: UploadFile, contentId?: string) {
    if (!file) {
      throw new NotFoundException("asset file not found");
    }

    const originalName = this.normalizeFileName(file.originalname);
    const isTextFile = this.isTextMimeType(file.mimetype);
    const isImageFile = this.isImageMimeType(file.mimetype);
    const previewText = isTextFile ? file.buffer.toString("utf8").slice(0, 8000) : undefined;
    let imageDesc = "";

    if (isImageFile && this.modelClient.hasRemoteProvider()) {
      try {
        imageDesc = await this.modelClient.describeImage(file.buffer, file.mimetype);
        if (imageDesc) {
          this.logger.debug(`Image description generated: ${imageDesc.slice(0, 80)}`);
        }
      } catch (error) {
        this.logger.verbose(`Generate image description skipped: ${(error as Error).message}`);
      }
    }

    const audit = await this.auditAssetInput({
      fileName: originalName,
      mimeType: file.mimetype,
      size: file.size,
      previewText,
      imageDesc,
    });

    if (audit.auditStatus === AssetAuditStatus.rejected) {
      throw new BadRequestException(audit.auditReason ?? "素材合规校验不通过");
    }

    const stored = await this.storage.saveBuffer({
      folder: "user-assets",
      fileName: originalName,
      mimeType: file.mimetype,
      buffer: file.buffer,
    });

    const asset = await this.prisma.asset.create({
      data: {
        uploaderId: userId,
        fileName: originalName,
        mimeType: file.mimetype,
        url: stored.url,
        source: "uploaded",
        metadata: {
          size: stored.size || file.size,
          originalName,
          storageKey: stored.storageKey,
          ...(previewText ? { previewText } : {}),
          ...(imageDesc ? { imageDesc } : {}),
        },
        auditStatus: audit.auditStatus,
        auditReason: audit.auditReason,
        riskLevel: audit.riskLevel,
        riskTypes: audit.riskTypes,
      },
    });

    if (contentId) {
      await this.link(userId, asset.id, contentId);
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
      update: {},
    });

    return {
      ok: true,
      contentId,
      asset: toAssetSummary(asset),
    };
  }

  async delete(userId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, uploaderId: userId } });
    if (!asset) {
      throw new NotFoundException("asset not found");
    }

    try {
      const metadata = asset.metadata && typeof asset.metadata === "object" ? (asset.metadata as Record<string, unknown>) : {};
      await this.storage.deleteObject({
        storageKey: typeof metadata.storageKey === "string" ? metadata.storageKey : undefined,
        url: asset.url,
      });
    } catch (error) {
      this.logger.warn(`Asset file deletion skipped: ${(error as Error).message}`);
    }

    await this.prisma.contentAsset.deleteMany({ where: { assetId: id } }).catch(() => {});
    await this.prisma.asset.delete({ where: { id } });
    return { ok: true, id };
  }

  private normalizeFileName(originalName: string) {
    if (!originalName) return originalName;

    try {
      if (/\p{Script=Han}/u.test(originalName)) return originalName;
    } catch (_) {
    }

    try {
      const converted = Buffer.from(originalName, "latin1").toString("utf8");
      if (/\p{Script=Han}/u.test(converted)) return converted;
      if (converted.length > originalName.length && /[\u4e00-\u9fff]/.test(converted)) return converted;
    } catch (_) {
    }

    return originalName;
  }

  private async auditAssetInput(
    input: { fileName: string; mimeType: string; size?: number; previewText?: string; imageDesc?: string }
  ) {
    const mimeType = input.mimeType.toLowerCase();
    if (!this.isSafeMimeType(mimeType)) {
      throw new BadRequestException("unsupported asset type");
    }

    if (input.size !== undefined) {
      if (this.isImageMimeType(mimeType) && input.size > MAX_IMAGE_SIZE) {
        throw new BadRequestException("image asset size exceeds 10MB");
      }
      if (this.isTextMimeType(mimeType) && input.size > MAX_TEXT_SIZE) {
        throw new BadRequestException("text asset size exceeds 2MB");
      }
    }

    const scanText = `${input.fileName}\n${input.previewText ?? ""}\n${input.imageDesc ?? ""}`.toLowerCase();
    const safetyResult = this.safetyRuleEngine.scan({
      title: scanText,
      body: "",
    });

    const blockingRisks = safetyResult.riskItems.filter(
      (item) => item.severity === "medium" || item.severity === "high",
    );

    if (blockingRisks.length > 0) {
      return {
        auditStatus: AssetAuditStatus.rejected,
        auditReason: `命中安全风险：${blockingRisks.map((r) => r.reason).join("；")}`,
        riskLevel: safetyResult.riskLevel,
        riskTypes: safetyResult.riskTypes,
      };
    }

    if (this.isImageMimeType(mimeType)) {
      return this.imageModeration.reviewImage({ fileName: input.fileName, imageDesc: input.imageDesc });
    }

    return {
      auditStatus: AssetAuditStatus.approved,
      auditReason: null,
      riskLevel: "low" as const,
      riskTypes: [],
    };
  }

  private isSafeMimeType(mimeType: string) {
    const normalized = mimeType.toLowerCase();
    return this.isImageMimeType(normalized) || this.isTextMimeType(normalized);
  }

  private isImageMimeType(mimeType: string) {
    return IMAGE_MIME_TYPES.includes(mimeType.toLowerCase());
  }

  private isTextMimeType(mimeType: string) {
    return TEXT_MIME_TYPES.includes(mimeType.toLowerCase());
  }
}
