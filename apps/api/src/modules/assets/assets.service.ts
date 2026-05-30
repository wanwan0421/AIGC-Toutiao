import { Injectable, NotFoundException } from "@nestjs/common";
import { AssetAuditStatus } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { toAssetSummary } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";

type UploadFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

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
    const safeName = this.normalizeFileName(body.fileName);
    const asset = await this.prisma.asset.create({
      data: {
        uploaderId: userId,
        fileName: safeName,
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

  async upload(userId: string, file: UploadFile, contentId?: string) {
    if (!file) {
      throw new NotFoundException("asset file not found");
    }

    const uploadDir = join(process.cwd(), "uploads");
    await mkdir(uploadDir, { recursive: true });

    // Normalize original filename encoding (handle common mojibake where
    // headers were decoded as latin1). Prefer the detected UTF-8/汉字 result.
    const originalName = this.normalizeFileName(file.originalname);
    const fileName = this.buildStoredFileName(originalName, file.mimetype);
    const filePath = join(uploadDir, fileName);
    const isTextFile = file.mimetype.startsWith("text/");
    const previewText = isTextFile ? file.buffer.toString("utf8").slice(0, 8000) : undefined;

    if (isTextFile) {
      await writeFile(filePath, file.buffer.toString("utf8"), "utf8");
    } else {
      await writeFile(filePath, file.buffer);
    }

    const asset = await this.prisma.asset.create({
      data: {
        uploaderId: userId,
        fileName: originalName,
        mimeType: file.mimetype,
        url: `/api/uploads/${fileName}`,
        source: "uploaded",
        metadata: {
          size: file.size,
          originalName: originalName,
          ...(previewText ? { previewText } : {}),
        },
        auditStatus: this.isSafeMimeType(file.mimetype) ? AssetAuditStatus.approved : AssetAuditStatus.pending
      }
    });

    if (contentId) {
      await this.link(userId, asset.id, contentId);
    }

    return toAssetSummary(asset);
  }

  private normalizeFileName(originalName: string) {
    if (!originalName) return originalName;
    // If the name already contains CJK characters, assume it's fine.
    try {
      if (/\p{Script=Han}/u.test(originalName)) return originalName;
    } catch (_) {
      // In case the environment doesn't support Unicode property escapes,
      // fall through to heuristic below.
    }

    // Try converting from latin1 (ISO-8859-1) to UTF-8 and check for CJK.
    try {
      const converted = Buffer.from(originalName, "latin1").toString("utf8");
      if (/\p{Script=Han}/u.test(converted)) return converted;
      // If converted contains visible printable chars and original didn't,
      // prefer converted when it seems more readable.
      if (converted.length > originalName.length && /[\u4e00-\u9fff]/.test(converted)) return converted;
    } catch (_) {
      // ignore conversion errors and return original
    }

    return originalName;
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

  async delete(userId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, uploaderId: userId } });
    if (!asset) {
      throw new NotFoundException("asset not found");
    }

    // Attempt to remove file from disk if present
    try {
      const storedName = asset.url.replace(/^\/api\/uploads\//, "");
      const uploadPath = join(process.cwd(), "uploads", storedName);
      const { unlink, stat } = await import("node:fs/promises");
      await stat(uploadPath).catch(() => null);
      await unlink(uploadPath).catch(() => {});
    } catch (_) {
      // ignore deletion errors
    }

    // Remove any content-asset relations first to avoid foreign key constraint
    await this.prisma.contentAsset.deleteMany({ where: { assetId: id } }).catch(() => {});
    await this.prisma.asset.delete({ where: { id } });
    return { ok: true, id };
  }

  private isSafeMimeType(mimeType: string) {
    return ["image/jpeg", "image/png", "image/webp", "text/plain", "text/markdown"].includes(mimeType);
  }

  private buildStoredFileName(originalName: string, mimeType: string) {
    const baseName = originalName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "_") || "asset";
    const extension = extname(originalName) || this.extensionForMimeType(mimeType);
    return `${baseName}-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
  }

  private extensionForMimeType(mimeType: string) {
    if (mimeType === "image/jpeg") return ".jpg";
    if (mimeType === "image/png") return ".png";
    if (mimeType === "image/webp") return ".webp";
    if (mimeType === "text/plain") return ".txt";
    if (mimeType === "text/markdown") return ".md";
    return "";
  }
}
