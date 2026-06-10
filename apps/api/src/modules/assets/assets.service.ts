import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AssetAuditStatus } from "@prisma/client";
import { toAssetSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { SafetyRuleEngine } from "../ai/safety/safety-rule-engine.service";
import { StorageService } from "../storage/storage.service";

type UploadFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp"];
const TEXT_MIME_TYPES = ["text/plain", "text/markdown", "text/x-markdown", "application/markdown"];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_TEXT_SIZE = 2 * 1024 * 1024;

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
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
        if (this.isImageMimeType(asset.mimeType)) {
          await this.prisma.asset.update({
            where: { id: asset.id },
            data: this.approvedAudit("图片基础校验通过"),
          });
          successCount += 1;
          continue;
        }

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
              auditReason: `历史重审命中风险词：${this.joinRiskReasons(blockingRisks)}`,
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
    const mimeType = this.normalizeMimeType(file.mimetype, originalName);
    const isTextFile = this.isTextMimeType(mimeType);
    const previewText = isTextFile ? file.buffer.toString("utf8").slice(0, 8000) : undefined;

    const audit = await this.auditAssetInput({
      fileName: originalName,
      mimeType,
      size: file.size,
      previewText,
    });

    if (audit.auditStatus === AssetAuditStatus.rejected) {
      throw new BadRequestException(audit.auditReason ?? "素材合规校验不通过");
    }

    const stored = await this.storage.saveBuffer({
      folder: "user-assets",
      fileName: originalName,
      mimeType,
      buffer: file.buffer,
    });

    const asset = await this.prisma.asset.create({
      data: {
        uploaderId: userId,
        fileName: originalName,
        mimeType,
        url: stored.url,
        source: "uploaded",
        metadata: {
          size: stored.size || file.size,
          originalName,
          storageKey: stored.storageKey,
          ...(previewText ? { previewText } : {}),
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
      throw new BadRequestException(`unsupported asset type: ${input.mimeType || "unknown"}`);
    }

    if (input.size !== undefined) {
      if (this.isImageMimeType(mimeType) && input.size > MAX_IMAGE_SIZE) {
        throw new BadRequestException("image asset size exceeds 10MB");
      }
      if (this.isTextMimeType(mimeType) && input.size > MAX_TEXT_SIZE) {
        throw new BadRequestException("text asset size exceeds 2MB");
      }
    }

    if (this.isImageMimeType(mimeType)) {
      return this.approvedAudit("图片基础校验通过");
    }

    const scanText = `${input.fileName}\n${input.previewText ?? ""}`.toLowerCase();
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
        auditReason: `命中安全风险：${this.joinRiskReasons(blockingRisks)}`,
        riskLevel: safetyResult.riskLevel,
        riskTypes: safetyResult.riskTypes,
      };
    }

    return this.approvedAudit(null);
  }

  private approvedAudit(auditReason: string | null) {
    return {
      auditStatus: AssetAuditStatus.approved,
      auditReason,
      riskLevel: "low" as const,
      riskTypes: [],
    };
  }

  private joinRiskReasons(risks: Array<{ reason?: string }>) {
    const reasons = Array.from(new Set(risks.map((risk) => risk.reason?.trim()).filter((reason): reason is string => Boolean(reason))));
    return reasons.length ? reasons.join("；") : "命中风险词";
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

  private normalizeMimeType(mimeType: string | undefined, fileName: string) {
    const normalized = mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (normalized && normalized !== "application/octet-stream") {
      return normalized;
    }

    const extension = fileName.split(".").pop()?.toLowerCase();
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "png") return "image/png";
    if (extension === "webp") return "image/webp";
    if (extension === "gif") return "image/gif";
    if (extension === "avif") return "image/avif";
    if (extension === "bmp") return "image/bmp";
    if (extension === "txt") return "text/plain";
    if (extension === "md" || extension === "markdown") return "text/markdown";
    return normalized || "application/octet-stream";
  }
}
