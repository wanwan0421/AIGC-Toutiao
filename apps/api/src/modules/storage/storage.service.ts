import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, normalize, sep } from "node:path";
import { getUploadPublicBase, getUploadRoot } from "./storage.config";

type SaveFileInput = {
  folder?: string;
  fileName?: string;
  mimeType?: string;
};

type SaveBufferInput = SaveFileInput & {
  buffer: Buffer;
};

export type StoredFile = {
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  url: string;
};

const THUMBNAIL_MAX_WIDTH = 400;
const THUMBNAIL_MAX_HEIGHT = 400;
const MAX_THUMBNAIL_SIZE_BYTES = 50 * 1024;

@Injectable()
export class LocalStorageAdapter {
  private readonly logger = new Logger(LocalStorageAdapter.name);
  private readonly uploadRoot = getUploadRoot();
  private readonly publicBase = getUploadPublicBase();

  async saveBuffer(input: SaveBufferInput): Promise<StoredFile> {
    const mimeType = input.mimeType ?? "application/octet-stream";
    const finalBuffer = input.buffer;
    const finalMimeType = mimeType;

    const fileName = this.buildStoredFileName(input.fileName ?? "asset", finalMimeType);
    const folder = this.normalizeFolder(input.folder);
    const storageKey = folder ? `${folder}/${fileName}` : fileName;
    const filePath = this.resolveStoragePath(storageKey);

    await mkdir(join(this.uploadRoot, folder), { recursive: true });
    await writeFile(filePath, finalBuffer);

    return {
      fileName,
      mimeType: finalMimeType,
      size: finalBuffer.byteLength,
      storageKey,
      url: `${this.publicBase}/${encodeURI(storageKey)}`,
    };
  }

  async deleteObject(storageKey: string) {
    const filePath = this.resolveStoragePath(storageKey);
    await stat(filePath).catch(() => null);
    await unlink(filePath).catch(() => {});
  }

  storageKeyFromPublicUrl(url?: string | null) {
    if (!url) return null;

    const cleanBase = this.publicBase.replace(/\/+$/, "");
    if (url.startsWith(`${cleanBase}/`)) {
      return decodeURI(url.slice(cleanBase.length + 1));
    }

    const uploadMatch = url.match(/\/api\/uploads\/(.+)$/);
    return uploadMatch?.[1] ? decodeURI(uploadMatch[1]) : null;
  }

  private resolveStoragePath(storageKey: string) {
    const safeKey = this.normalizeStorageKey(storageKey);
    const root = normalize(this.uploadRoot);
    const target = normalize(join(root, safeKey));
    const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;

    if (target !== root && !target.startsWith(rootWithSep)) {
      throw new BadRequestException("invalid storage key");
    }

    return target;
  }

  private normalizeStorageKey(value: string) {
    const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.split("/").some((part) => part === "..")) {
      throw new BadRequestException("invalid storage key");
    }
    return normalized;
  }

  private normalizeFolder(folder?: string) {
    if (!folder) return "";
    return folder
      .replace(/\\/g, "/")
      .split("/")
      .map((part) => this.sanitizePathPart(part))
      .filter(Boolean)
      .join("/");
  }

  private buildStoredFileName(originalName: string, mimeType: string) {
    const extension = extname(originalName) || this.extensionForMimeType(mimeType);
    const baseName = basename(originalName, extname(originalName))
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "asset";

    return `${baseName}-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
  }

  private sanitizePathPart(value: string) {
    return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
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

@Injectable()
export class StorageService {
  constructor(private readonly localAdapter: LocalStorageAdapter) {}

  saveBuffer(input: SaveBufferInput) {
    return this.localAdapter.saveBuffer(input);
  }

  async saveRemoteFile(url: string, input: SaveFileInput = {}) {
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`remote file download failed: ${response.status} ${errorText}`);
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
    const buffer = Buffer.from(await response.arrayBuffer());
    return this.saveBuffer({
      ...input,
      buffer,
      mimeType: contentType ?? input.mimeType ?? this.mimeFromUrl(url),
      fileName: input.fileName ?? this.fileNameFromUrl(url),
    });
  }

  saveDataUrl(dataUrl: string, input: SaveFileInput = {}) {
    const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!match) {
      throw new BadRequestException("invalid data URL");
    }

    const mimeType = input.mimeType ?? match[1] ?? "image/png";
    const raw = match[3] ?? "";
    const buffer = match[2] ? Buffer.from(raw, "base64") : Buffer.from(decodeURIComponent(raw), "utf8");

    return this.saveBuffer({
      ...input,
      buffer,
      mimeType,
      fileName: input.fileName ?? `asset${this.extensionForMimeType(mimeType)}`,
    });
  }

  async deleteObject(input: { storageKey?: string | null; url?: string | null }) {
    const storageKey = input.storageKey ?? this.localAdapter.storageKeyFromPublicUrl(input.url);
    if (!storageKey) return false;
    await this.localAdapter.deleteObject(storageKey);
    return true;
  }

  private fileNameFromUrl(url: string) {
    try {
      const parsed = new URL(url);
      const name = basename(parsed.pathname);
      return name || "asset";
    } catch {
      return "asset";
    }
  }

  private mimeFromUrl(url: string) {
    const extension = this.extensionFromUrl(url);
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "webp") return "image/webp";
    if (extension === "png") return "image/png";
    return "application/octet-stream";
  }

  private extensionFromUrl(url: string) {
    const match = url.split("?")[0]?.match(/\.([a-zA-Z0-9]+)$/);
    return match?.[1]?.toLowerCase() || "";
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
