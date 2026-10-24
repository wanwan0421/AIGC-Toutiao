import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AssetAuditStatus, AssetTextStatus } from "@prisma/client";
import { countArticleCharacters } from "@aicp/shared";
import { toAssetSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { SafetyRuleEngine } from "../ai/safety/safety-rule-engine.service";
import { StorageService } from "../storage/storage.service";
import { ContentReviewPolicyService } from "../workflow/content-review-policy.service";
import { fileTypeFromBuffer } from "file-type";
import sharp, { type Metadata } from "sharp";
import { UserRateLimitService } from "../workflow/user-rate-limit.service";
import { AppError } from "../../common/app-error";
import {
  extractTextMaterial,
  reviewEntireText,
  textMaterialHash,
  textMaterialMimeType,
  textMaterialMaxBytes,
  MAX_TEXT_MATERIAL_BYTES,
  TEXT_EXTRACTOR_VERSION,
} from "./text-material";

type UploadFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp"];
const TEXT_MIME_TYPES = [
  "text/plain", "text/markdown", "text/x-markdown", "application/markdown",
  "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_TEXT_SIZE = MAX_TEXT_MATERIAL_BYTES;

export type ResolvedTextMaterial = {
  assetId: string;
  fileName: string;
  fullText: string;
  fileHash: string;
  auditedHash: string;
  mimeType: string;
};

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly safetyRuleEngine: SafetyRuleEngine,
    private readonly reviewPolicy: ContentReviewPolicyService,
    private readonly rateLimit: UserRateLimitService
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
    let skippedImageCount = 0;

    for (const asset of pendingAssets) {
      try {
        if (this.isImageMimeType(asset.mimeType)) {
          // Images are reviewed only as part of an author's asynchronous
          // content review, where text and attached images share one result.
          skippedImageCount += 1;
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
      skippedImages: skippedImageCount,
    };
  }

  async create(userId: string, body: { fileName: string; mimeType: string; url: string; contentId?: string }) {
    await this.rateLimit.consume(userId, "write");
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
    await this.rateLimit.consume(userId, "upload");
    if (!file) {
      throw new NotFoundException("asset file not found");
    }

    const originalName = this.normalizeFileName(file.originalname);
    let mimeType = this.normalizeMimeType(file.mimetype, originalName);
    if (/\.(?:txt|md|markdown|pdf|docx)$/i.test(originalName) && !this.isTextMimeType(mimeType)) {
      throw new AppError({ code: "MATERIAL_TYPE_UNSUPPORTED", message: "文件实际类型与文档扩展名不一致", statusCode: 422 });
    }
    let safeBuffer = file.buffer;
    let imageMetadata: Record<string, unknown> = {};
    if (this.isImageMimeType(mimeType)) {
      const validated = await this.validateImage(file.buffer, mimeType);
      mimeType = validated.mimeType;
      safeBuffer = validated.buffer;
      imageMetadata = validated.metadata;
    }
    const isTextFile = this.isTextMimeType(mimeType);
    let fullText: string | undefined;
    let fileHash: string | undefined;
    if (isTextFile) {
      const extracted = await extractTextMaterial(file.buffer, originalName, mimeType);
      mimeType = extracted.mimeType;
      fullText = extracted.fullText;
      fileHash = textMaterialHash(file.buffer);
      const fullReview = reviewEntireText(originalName, fullText, this.safetyRuleEngine);
      if (!fullReview.approved) {
        throw new AppError({ code: "MATERIAL_FULL_TEXT_REJECTED", message: `文件全文审核未通过：${fullReview.reason}`, statusCode: 422 });
      }
    }
    const previewText = fullText?.slice(0, 8000);

    // Image uploads only perform technical validation and safe re-encoding.
    // Content moderation runs later when the author explicitly submits the
    // complete content for asynchronous review.
    const audit = this.isImageMimeType(mimeType)
      ? { auditStatus: AssetAuditStatus.pending, auditReason: null, riskLevel: "unknown" as const, riskTypes: [] as string[] }
      : await this.auditAssetInput({
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
      buffer: safeBuffer,
    });

    if (fileHash) {
      try {
        const persistedBuffer = await this.storage.readBuffer(stored.storageKey);
        if (textMaterialHash(persistedBuffer) !== fileHash) throw new Error("stored content hash changed");
      } catch {
        await this.storage.deleteObject({ storageKey: stored.storageKey }).catch(() => {});
        throw new AppError({ code: "MATERIAL_STORAGE_UNAVAILABLE", message: "上传文件存储不可读取，请重试", statusCode: 422 });
      }
    }

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
          ...imageMetadata,
        },
        auditStatus: audit.auditStatus,
        auditReason: audit.auditReason,
        riskLevel: audit.riskLevel,
        riskTypes: audit.riskTypes,
        ...(fullText !== undefined && fileHash ? {
          extractedText: {
            create: {
              fullText,
              charCount: countArticleCharacters(fullText),
              fileHash,
              extractorVersion: TEXT_EXTRACTOR_VERSION,
              status: AssetTextStatus.extracted,
              fullTextAuditStatus: AssetAuditStatus.approved,
              auditedHash: fileHash,
              extractedAt: new Date(),
            },
          },
        } : {}),
      },
    });

    if (contentId) {
      await this.link(userId, asset.id, contentId);
    }

    return toAssetSummary(asset);
  }

  async resolveTextMaterial(userId: string, assetId: string): Promise<ResolvedTextMaterial> {
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, uploaderId: userId } });
    if (!asset) throw new NotFoundException("asset not found");

    const mimeType = textMaterialMimeType(asset.fileName, asset.mimeType);
    if (asset.auditStatus !== AssetAuditStatus.approved) {
      throw new AppError({ code: "MATERIAL_ASSET_NOT_APPROVED", message: "文件素材尚未通过资产审核", statusCode: 422 });
    }
    const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
      ? asset.metadata as Record<string, unknown>
      : {};
    const storageKey = typeof metadata.storageKey === "string" ? metadata.storageKey : undefined;
    if (asset.source !== "uploaded" || !storageKey) {
      throw new AppError({ code: "MATERIAL_STORAGE_UNAVAILABLE", message: "该资产没有可读取的原始上传文件", statusCode: 422 });
    }

    let buffer: Buffer;
    try {
      buffer = await this.storage.readBuffer(storageKey);
    } catch {
      await this.prisma.assetExtractedText.upsert({
        where: { assetId },
        create: { assetId, status: AssetTextStatus.failed, errorMessage: "原始文件不可读取" },
        update: {
          fullText: null, charCount: null, fileHash: null, extractorVersion: TEXT_EXTRACTOR_VERSION,
          status: AssetTextStatus.failed, errorMessage: "原始文件不可读取",
          fullTextAuditStatus: AssetAuditStatus.pending, auditedHash: null, extractedAt: null,
        },
      });
      throw new AppError({ code: "MATERIAL_STORAGE_UNAVAILABLE", message: "原始上传文件不可读取", statusCode: 422 });
    }

    const fileHash = textMaterialHash(buffer);
    if (buffer.byteLength > textMaterialMaxBytes(asset.fileName, mimeType)) {
      const message = mimeType.startsWith("text/") ? "TXT/MD 文件不能超过 2 MB" : "PDF/DOCX 文件不能超过 10 MB";
      throw new AppError({ code: "MATERIAL_FILE_TOO_LARGE", message, statusCode: 422 });
    }
    const cached = await this.prisma.assetExtractedText.findUnique({ where: { assetId } });
    if (cached?.fileHash === fileHash && cached.extractorVersion === TEXT_EXTRACTOR_VERSION &&
        cached.status === AssetTextStatus.extracted && cached.fullText !== null) {
      if (cached.fullTextAuditStatus === AssetAuditStatus.approved && cached.auditedHash === fileHash) {
        await this.assertTextAssetStillCurrent(userId, assetId, storageKey);
        return { assetId, fileName: asset.fileName, fullText: cached.fullText, fileHash, auditedHash: fileHash, mimeType };
      }
      if (cached.fullTextAuditStatus === AssetAuditStatus.rejected && cached.auditedHash === fileHash) {
        throw new AppError({ code: "MATERIAL_FULL_TEXT_REJECTED", message: "文件全文审核未通过", statusCode: 422 });
      }
    }

    let fullText: string;
    try {
      fullText = (await extractTextMaterial(buffer, asset.fileName, mimeType)).fullText;
    } catch (error) {
      await this.prisma.assetExtractedText.upsert({
        where: { assetId },
        create: {
          assetId, fileHash, extractorVersion: TEXT_EXTRACTOR_VERSION, status: AssetTextStatus.failed,
          errorMessage: error instanceof Error ? error.message : "文本提取失败",
        },
        update: {
          fullText: null, charCount: null, fileHash, extractorVersion: TEXT_EXTRACTOR_VERSION,
          status: AssetTextStatus.failed, errorMessage: error instanceof Error ? error.message : "文本提取失败",
          fullTextAuditStatus: AssetAuditStatus.pending, auditedHash: null, extractedAt: null,
        },
      });
      throw error;
    }

    const fullReview = reviewEntireText(asset.fileName, fullText, this.safetyRuleEngine);
    const fullTextAuditStatus = fullReview.approved ? AssetAuditStatus.approved : AssetAuditStatus.rejected;
    await this.prisma.assetExtractedText.upsert({
      where: { assetId },
      create: {
        assetId, fullText, charCount: countArticleCharacters(fullText), fileHash,
        extractorVersion: TEXT_EXTRACTOR_VERSION, status: AssetTextStatus.extracted,
        fullTextAuditStatus, auditedHash: fileHash, extractedAt: new Date(),
      },
      update: {
        fullText, charCount: countArticleCharacters(fullText), fileHash,
        extractorVersion: TEXT_EXTRACTOR_VERSION, status: AssetTextStatus.extracted,
        errorMessage: null, fullTextAuditStatus, auditedHash: fileHash, extractedAt: new Date(),
      },
    });
    if (!fullReview.approved) {
      throw new AppError({ code: "MATERIAL_FULL_TEXT_REJECTED", message: "文件全文审核未通过", statusCode: 422 });
    }
    await this.assertTextAssetStillCurrent(userId, assetId, storageKey);
    return { assetId, fileName: asset.fileName, fullText, fileHash, auditedHash: fileHash, mimeType };
  }

  async assertTextMaterialSnapshotCurrent(userId: string, snapshot: Pick<ResolvedTextMaterial, "assetId" | "fileHash" | "auditedHash">) {
    const current = await this.resolveTextMaterial(userId, snapshot.assetId);
    if (current.fileHash !== snapshot.fileHash || current.auditedHash !== snapshot.auditedHash) {
      throw new AppError({ code: "MATERIAL_SNAPSHOT_STALE", message: "文件素材已变化，请重新创建生成任务", statusCode: 409 });
    }
    return current;
  }

  private async assertTextAssetStillCurrent(userId: string, assetId: string, storageKey: string) {
    const current = await this.prisma.asset.findFirst({ where: { id: assetId, uploaderId: userId } });
    if (!current) throw new NotFoundException("asset not found");
    if (current.auditStatus !== AssetAuditStatus.approved) {
      throw new AppError({ code: "MATERIAL_ASSET_NOT_APPROVED", message: "文件素材尚未通过资产审核", statusCode: 422 });
    }
    const metadata = current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
      ? current.metadata as Record<string, unknown>
      : {};
    if (current.source !== "uploaded" || metadata.storageKey !== storageKey) {
      throw new AppError({ code: "MATERIAL_SNAPSHOT_STALE", message: "文件素材已变化，请重新创建生成任务", statusCode: 409 });
    }
  }

  async link(userId: string, id: string, contentId: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, uploaderId: userId } });
    if (!asset) {
      throw new NotFoundException("asset not found");
    }
    if (asset.auditStatus !== AssetAuditStatus.approved && !this.isImageMimeType(asset.mimeType)) {
      throw new BadRequestException("asset has not passed content moderation");
    }

    const content = await this.prisma.content.findFirst({ where: { id: contentId, authorId: userId } });
    if (!content) {
      throw new NotFoundException("content not found");
    }

    const relationWhere = { contentId_assetId: { contentId, assetId: id } };
    const existingRelation = await this.prisma.contentAsset.findUnique({ where: relationWhere });
    if (!existingRelation) {
      await this.prisma.contentAsset.create({
        data: { contentId, assetId: id },
      });
      await this.prisma.content.update({
        where: { id: contentId },
        data: this.reviewPolicy.statusDataForSafetySensitiveEdit(content.status),
      });
    }

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

    const linkedContents = await this.prisma.contentAsset.findMany({
      where: { assetId: id, content: { authorId: userId } },
      select: { content: { select: { id: true, status: true } } },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.contentAsset.deleteMany({ where: { assetId: id } });
      for (const item of linkedContents) {
        await tx.content.update({
          where: { id: item.content.id },
          data: this.reviewPolicy.statusDataForSafetySensitiveEdit(item.content.status),
        });
      }
      await tx.asset.delete({ where: { id } });
    });
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
    input: { fileName: string; mimeType: string; size?: number; previewText?: string }
  ) {
    const mimeType = input.mimeType.toLowerCase();
    if (!this.isSafeMimeType(mimeType)) {
      throw new BadRequestException(`unsupported asset type: ${input.mimeType || "unknown"}`);
    }

    if (input.size !== undefined) {
      if (this.isImageMimeType(mimeType) && input.size > MAX_IMAGE_SIZE) {
        throw new BadRequestException("image asset size exceeds 10MB");
      }
      if (this.isTextMimeType(mimeType)) {
        const maxSize = textMaterialMaxBytes(input.fileName, mimeType);
        if (input.size > maxSize) {
          throw new BadRequestException(maxSize === MAX_TEXT_SIZE ? "TXT/MD 文件不能超过 2 MB" : "PDF/DOCX 文件不能超过 10 MB");
        }
      }
    }

    if (this.isImageMimeType(mimeType)) {
      return { auditStatus: AssetAuditStatus.pending, auditReason: null, riskLevel: "unknown" as const, riskTypes: [] as string[] };
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
    if (extension === "pdf") return "application/pdf";
    if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return normalized || "application/octet-stream";
  }

  private async validateImage(buffer: Buffer, declaredMimeType: string) {
    if (buffer.byteLength > MAX_IMAGE_SIZE) throw new BadRequestException("image asset size exceeds 10MB");
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !this.isImageMimeType(detected.mime)) throw new BadRequestException("invalid or unsupported image content");
    if (declaredMimeType !== "application/octet-stream" && detected.mime !== declaredMimeType) {
      throw new BadRequestException("declared image type does not match file content");
    }
    let metadata: Metadata;
    try {
      metadata = await sharp(buffer, { animated: true, limitInputPixels: 40_000_000 }).metadata();
    } catch {
      throw new BadRequestException("image decoding failed");
    }
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const pages = metadata.pages ?? 1;
    if (!width || !height || width > 16_384 || height > 16_384 || width * height > 40_000_000 || pages > 200) {
      throw new BadRequestException("image dimensions, pixels, or frame count exceed limits");
    }
    // Re-encode to strip untrusted metadata and ensure the decoder consumed a
    // valid image. Animated input is normalized to a safe first-frame WebP.
    const normalized = await sharp(buffer, { page: 0, limitInputPixels: 40_000_000 }).rotate().webp({ quality: 90 }).toBuffer();
    return { buffer: normalized, mimeType: "image/webp", metadata: { width, height, pages, originalMimeType: detected.mime } };
  }
}
