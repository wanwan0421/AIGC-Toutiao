import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AssetAuditStatus } from "@prisma/client";
import { toAssetSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

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
const BUILT_IN_BLOCKED_TERMS = ["赌博", "博彩", "毒品", "诈骗", "色情", "裸聊", "洗钱"];

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
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

  async create(userId: string, body: { fileName: string; mimeType: string; url: string; contentId?: string }) {
    const safeName = this.normalizeFileName(body.fileName);
    const audit = await this.auditAssetInput(userId, {
      fileName: safeName,
      mimeType: body.mimeType
    });
    const asset = await this.prisma.asset.create({
      data: {
        uploaderId: userId,
        fileName: safeName,
        mimeType: body.mimeType,
        url: body.url,
        auditStatus: audit.auditStatus,
        auditReason: audit.auditReason,
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

    // 浏览器上传的文件名偶尔会被错误解码，这里统一修正后再入库展示。
    const originalName = this.normalizeFileName(file.originalname);
    const isTextFile = this.isTextMimeType(file.mimetype);
    const previewText = isTextFile ? file.buffer.toString("utf8").slice(0, 8000) : undefined;
    const audit = await this.auditAssetInput(userId, {
      fileName: originalName,
      mimeType: file.mimetype,
      size: file.size,
      previewText
    });
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
        },
        auditStatus: audit.auditStatus,
        auditReason: audit.auditReason,
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

    // 删除素材时同步清理本地文件；外部 URL 类型资产则只删除数据库记录。
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
      // 部分运行环境不支持 Unicode property escapes，下面还有普通区间兜底。
    }

    try {
      const converted = Buffer.from(originalName, "latin1").toString("utf8");
      if (/\p{Script=Han}/u.test(converted)) return converted;
      if (converted.length > originalName.length && /[\u4e00-\u9fff]/.test(converted)) return converted;
    } catch (_) {
      // 转换失败时保留原始文件名。
    }

    return originalName;
  }

  private async auditAssetInput(
    userId: string,
    input: { fileName: string; mimeType: string; size?: number; previewText?: string }
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

    const blockedTerms = await this.getBlockedTerms(userId);
    const scanText = `${input.fileName}\n${input.previewText ?? ""}`.toLowerCase();
    const matchedTerms = blockedTerms.filter((term) => term && scanText.includes(term.toLowerCase()));
    const reasons =
      matchedTerms.length > 0
        ? [`命中基础敏感词：${Array.from(new Set(matchedTerms)).slice(0, 5).join("、")}`]
        : [];

    return {
      auditStatus: reasons.length > 0 ? AssetAuditStatus.rejected : AssetAuditStatus.approved,
      auditReason: reasons.join("；") || null
    };
  }

  private async getBlockedTerms(userId: string) {
    const preference = await this.prisma.userPreference.findUnique({ where: { userId } });
    return [...BUILT_IN_BLOCKED_TERMS, ...(preference?.blockedWords ?? [])]
      .map((term) => term.trim())
      .filter(Boolean);
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
