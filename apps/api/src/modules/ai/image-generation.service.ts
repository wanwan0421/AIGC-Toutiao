import { BadRequestException, Injectable, Logger, Optional } from "@nestjs/common";
import { AssetAuditStatus, Prisma, type Asset } from "@prisma/client";
import type { GeneratedImageAsset } from "@aicp/shared";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AppError, throwIfAborted } from "../../common/app-error";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { ImageModerationService } from "../assets/image-moderation.service";
import { AiCallLogService } from "./ai-call-log.service";

type GeneratedImageOutput = {
  kind: "remoteUrl" | "dataUrl";
  value: string;
  mimeType: string;
  extension: string;
};

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);
  private readonly apiKey = process.env.ARK_IMAGE_API_KEY ?? process.env.ARK_API_KEY;
  private readonly apiUrl =
    process.env.ARK_IMAGE_API_URL ??
    process.env.ARK_IMAGE_BASE_URL ??
    "https://ark.cn-beijing.volces.com/api/v3/images/generations";
  private readonly model = process.env.ARK_IMAGE_MODEL_ID ?? process.env.ARK_IMAGE_MODEL;
  private readonly imageSize = process.env.ARK_IMAGE_SIZE ?? "4704x3520";

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly imageModeration: ImageModerationService,
    @Optional() private readonly callLogs?: AiCallLogService
  ) {}

  configStatus() {
    const missing = [
      this.apiKey ? null : "ARK_IMAGE_API_KEY or ARK_API_KEY",
      this.model ? null : "ARK_IMAGE_MODEL_ID or ARK_IMAGE_MODEL",
      this.isValidApiUrl() ? null : "ARK_IMAGE_API_URL or ARK_IMAGE_BASE_URL",
    ].filter((item): item is string => Boolean(item));

    return {
      configured: missing.length === 0,
      provider: "volcengine-ark",
      apiUrl: this.apiUrl,
      model: this.model ?? null,
      imageSize: this.imageSize,
      hasApiKey: Boolean(this.apiKey),
      missing,
    };
  }

  async generateSingleImage(input: {
    userId?: string;
    contentId?: string;
    position?: string;
    prompt: string;
    slotId?: string;
    signal?: AbortSignal;
    generationKey?: string;
    aiJobId?: string;
    conversationId?: string;
  }) {
    const userId = await this.resolveUserId(input.userId);
    if (input.generationKey) {
      const existing = await this.prisma.asset.findUnique({ where: { generationKey: input.generationKey } });
      if (existing) {
        return this.toGeneratedAsset(existing, {
          position: input.position ?? "正文配图",
          prompt: input.prompt,
          slotId: input.slotId,
        });
      }
    }
    const startedAt = Date.now();
    try {
      const asset = await this.generateAndStore({
        userId,
        contentId: input.contentId,
        position: input.position ?? "正文配图",
        prompt: input.prompt,
        slotId: input.slotId,
        signal: input.signal,
        generationKey: input.generationKey,
        aiJobId: input.aiJobId,
        conversationId: input.conversationId,
      });
      await this.logGeneration(input, Date.now() - startedAt, true, asset);
      return asset;
    } catch (error) {
      const upstreamBody = error instanceof AppError && typeof error.details?.upstreamBody === "string"
        ? `; upstream=${error.details.upstreamBody}`
        : "";
      await this.logGeneration(
        input,
        Date.now() - startedAt,
        false,
        undefined,
        `${error instanceof Error ? error.message : "Image generation failed"}${upstreamBody}`,
      );
      throw error;
    }
  }

  // 调用LLM生成图片，保存到存储层，并在数据库创建素材记录。返回最终的素材信息供前端使用
  private async generateAndStore(input: {
    userId: string;
    contentId?: string;
    position: string;
    prompt: string;
    slotId?: string;
    signal?: AbortSignal;
    generationKey?: string;
    aiJobId?: string;
    conversationId?: string;
  }): Promise<GeneratedImageAsset> {
    throwIfAborted(input.signal);
    if (input.generationKey) {
      const existing = await this.prisma.asset.findUnique({ where: { generationKey: input.generationKey } });
      if (existing) return this.toGeneratedAsset(existing, input);
    }

    const output = await this.generateImage(input.prompt, input.signal);
    const requestedFileName = `ai-${Date.now()}-${randomUUID().slice(0, 8)}.${output.extension}`;
    const stored =
      output.kind === "dataUrl"
        ? await this.storage.saveDataUrl(output.value, {
            folder: "ai-images",
            fileName: requestedFileName,
            mimeType: output.mimeType,
          })
        : await this.storage.saveRemoteFile(output.value, {
            folder: "ai-images",
            fileName: requestedFileName,
            mimeType: output.mimeType,
          }, input.signal);

    let moderation;
    try {
      const inspected = await this.inspectStoredImage(stored.storageKey, input.signal);
      moderation = await this.imageModeration.reviewImage({
        buffer: inspected.buffer,
        mimeType: inspected.mimeType,
        fileName: requestedFileName,
        signal: input.signal,
        aiJobId: input.aiJobId,
        contentId: input.contentId,
        conversationId: input.conversationId,
      });
    } catch (error) {
      await this.storage.deleteObject({ storageKey: stored.storageKey }).catch(() => undefined);
      throw error;
    }

    const metadata: Prisma.InputJsonObject = {
      prompt: input.prompt,
      position: input.position,
      ...(input.slotId ? { slotId: input.slotId } : {}),
      provider: "volcengine-ark",
      imageSize: this.imageSize,
      storageKey: stored.storageKey,
      size: stored.size,
      ...(this.model ? { model: this.model } : {}),
      ...(input.generationKey ? { generationKey: input.generationKey } : {}),
      ...(output.kind === "remoteUrl" ? { originalProviderHost: this.hostFromUrl(output.value) } : {}),
    };

    let asset;
    try {
      asset = await this.prisma.asset.create({
        data: {
        uploaderId: input.userId,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        url: stored.url,
        source: "ai_generated",
        generationKey: input.generationKey,
        auditStatus: moderation.auditStatus,
        auditReason: moderation.auditReason,
        riskLevel: moderation.riskLevel,
        riskTypes: moderation.riskTypes,
        metadata,
        },
      });
    } catch (error) {
      if (input.generationKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        await this.storage.deleteObject({ storageKey: stored.storageKey }).catch(() => undefined);
        const existing = await this.prisma.asset.findUniqueOrThrow({ where: { generationKey: input.generationKey } });
        return this.toGeneratedAsset(existing, input);
      }
      throw error;
    }
    return this.toGeneratedAsset(asset, input);
  }

  private toGeneratedAsset(asset: Asset, input: {
    position: string;
    prompt: string;
    slotId?: string;
  }): GeneratedImageAsset {
    return {
      id: asset.id,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      url: asset.url,
      auditStatus: asset.auditStatus,
      source: asset.source,
      metadata: asset.metadata && typeof asset.metadata === "object" ? (asset.metadata as Record<string, unknown>) : undefined,
      position: input.position,
      prompt: input.prompt,
      slotId: input.slotId,
    };
  }

  // 调用LLM生成图片
  private async generateImage(prompt: string, signal?: AbortSignal): Promise<GeneratedImageOutput> {
    this.assertConfigured();
    throwIfAborted(signal);

    let response: Response;
    try {
      response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, prompt, size: this.imageSize, response_format: "url" }),
        signal,
      });
    } catch (error) {
      throwIfAborted(signal);
      throw new AppError({ code: "UPSTREAM_UNAVAILABLE", message: error instanceof Error ? error.message : "Image generation failed", statusCode: 503, retryable: true, cause: error });
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      this.logger.error(`Ark image generation failed: status=${response.status}; url=${this.apiUrl}; body=${errorText.slice(0, 500)}`);
      const retryable = response.status === 429 || response.status >= 500;
      throw new AppError({
        code: response.status === 429 ? "UPSTREAM_RATE_LIMITED" : retryable ? "UPSTREAM_UNAVAILABLE" : response.status === 401 || response.status === 403 ? "UPSTREAM_AUTH_FAILED" : "UPSTREAM_BAD_REQUEST",
        message: response.status === 429
          ? "图片生成服务请求过于频繁"
          : response.status >= 400 && response.status < 500
            ? "图片生成请求被模型服务拒绝，请检查提示词是否包含不支持或高风险内容"
            : "图片生成服务暂时不可用",
        statusCode: 502,
        retryable,
        details: {
          service: "image_generation",
          upstreamStatus: response.status,
          upstreamBody: errorText.slice(0, 500),
        },
      });
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const image = this.extractImage(payload);
    if (!image) {
      throw new AppError({ code: "UPSTREAM_INVALID_RESPONSE", message: "Ark image generation response did not contain an image URL or base64 payload", statusCode: 502, retryable: true });
    }

    return image;
  }

  private extractImage(payload: Record<string, unknown>): GeneratedImageOutput | null {
    const data = payload.data;
    if (Array.isArray(data)) {
      for (const item of data) {
        const image = this.extractImageFromAny(item);
        if (image) return image;
      }
    }

    return this.extractImageFromAny(payload);
  }

  // 从任意对象中递归提取图片信息，支持直接的URL或Base64字段，或嵌套在其他字段中的情况
  private extractImageFromAny(value: unknown): GeneratedImageOutput | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;

    const url = record.url;
    if (typeof url === "string" && url) {
      return {
        kind: "remoteUrl",
        value: url,
        mimeType: this.mimeFromUrl(url),
        extension: this.extensionFromUrl(url),
      };
    }

    const base64 = record.b64_json ?? record.base64 ?? record.image_base64;
    if (typeof base64 === "string" && base64) {
      const dataUrl = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
      const mimeType = this.mimeFromDataUrl(dataUrl);
      return {
        kind: "dataUrl",
        value: dataUrl,
        mimeType,
        extension: this.extensionForMimeType(mimeType),
      };
    }

    for (const candidate of Object.values(record)) {
      const nested = this.extractImageFromAny(candidate);
      if (nested) return nested;
    }

    return null;
  }

  private async resolveUserId(userId?: string) {
    if (userId) return userId;
    throw new BadRequestException("authenticated user is required for image generation");
  }

  private assertConfigured() {
    const status = this.configStatus();
    if (!status.configured) {
      throw new AppError({
        code: "AI_CONFIGURATION_ERROR",
        message: `Image generation is not configured: missing ${status.missing.join(", ")}`,
        statusCode: 500,
        retryable: false,
        details: { service: "image_generation", missing: status.missing },
      });
    }
  }

  private isValidApiUrl() {
    try {
      const url = new URL(this.apiUrl);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  private extensionFromUrl(url: string) {
    const extension = url.split("?")[0]?.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
    if (extension === "jpg" || extension === "jpeg" || extension === "png" || extension === "webp") return extension;
    return "png";
  }

  private mimeFromUrl(url: string) {
    const extension = this.extensionFromUrl(url);
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "webp") return "image/webp";
    return "image/png";
  }

  private mimeFromDataUrl(dataUrl: string) {
    return dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "image/png";
  }

  private extensionForMimeType(mimeType: string) {
    if (mimeType === "image/jpeg") return "jpg";
    if (mimeType === "image/webp") return "webp";
    return "png";
  }

  private hostFromUrl(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return "unknown";
    }
  }

  private async inspectStoredImage(storageKey: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    const buffer = await this.storage.readBuffer(storageKey);
    if (buffer.byteLength > 10 * 1024 * 1024) throw new AppError({ code: "IMAGE_TOO_LARGE", message: "Generated image exceeds size limit", statusCode: 422, retryable: false });
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected?.mime.startsWith("image/")) throw new AppError({ code: "INVALID_IMAGE", message: "Generated file is not an image", statusCode: 422, retryable: false });
    const metadata = await sharp(buffer, { animated: true, limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height || metadata.width > 16_384 || metadata.height > 16_384 || metadata.width * metadata.height > 40_000_000 || (metadata.pages ?? 1) > 200) {
      throw new AppError({ code: "IMAGE_DIMENSIONS_EXCEEDED", message: "Generated image dimensions exceed limits", statusCode: 422, retryable: false });
    }
    return { buffer, mimeType: detected.mime };
  }

  private async logGeneration(
    input: { prompt: string; contentId?: string; aiJobId?: string; conversationId?: string },
    latencyMs: number,
    success: boolean,
    output?: unknown,
    errorMessage?: string,
  ) {
    if (!this.callLogs) return;
    await this.callLogs.log({
      scene: "creative_image_generate",
      model: this.model,
      provider: "volcengine_ark",
      apiStyle: "images",
      aiJobId: input.aiJobId,
      contentId: input.contentId,
      conversationId: input.conversationId,
      inputSummary: input.prompt.replace(/\s+/g, " ").slice(0, 200),
      output,
      latencyMs,
      cacheStrategy: "off",
      traceEnabled: false,
      success,
      errorMessage,
    }).catch((error: unknown) => {
      this.logger.warn(`Failed to persist image generation usage: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
