import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { AssetAuditStatus } from "@prisma/client";
import type { GeneratedImageAsset } from "@aicp/shared";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../infra/prisma/prisma.service";

type ImagePrompt = {
  position: string;
  prompt: string;
};

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);
  private readonly apiKey = process.env.ARK_API_KEY;
  private readonly apiUrl = process.env.ARK_IMAGE_API_URL ?? "https://ark.cn-beijing.volces.com/api/v3/images/generations";
  private readonly model = process.env.ARK_IMAGE_MODEL;
  private readonly imageSize = process.env.ARK_IMAGE_SIZE ?? "4704x3520";

  constructor(private readonly prisma: PrismaService) {}

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

  // 根据创作初稿中的图片提示词生成图片，并把生成结果挂到素材库。
  async generateForDraft(input: {
    userId?: string;
    contentId?: string;
    coverSuggestion?: string;
    imagePrompts: ImagePrompt[];
  }) {
    const userId = await this.resolveUserId(input.userId);
    const coverAsset = input.coverSuggestion
      ? await this.generateAndStore({
          userId,
          contentId: input.contentId,
          position: "封面",
          prompt: input.coverSuggestion,
        })
      : undefined;

    const imageAssets: GeneratedImageAsset[] = [];
    for (const item of input.imagePrompts) {
      imageAssets.push(
        await this.generateAndStore({
          userId,
          contentId: input.contentId,
          position: item.position,
          prompt: item.prompt,
        })
      );
    }

    return { coverAsset, imageAssets };
  }

  async generateSingleImage(input: {
    userId?: string;
    contentId?: string;
    position?: string;
    prompt: string;
  }) {
    const userId = await this.resolveUserId(input.userId);
    return this.generateAndStore({
      userId,
      contentId: input.contentId,
      position: input.position ?? "正文配图",
      prompt: input.prompt,
    });
  }

  private async generateAndStore(input: {
    userId: string;
    contentId?: string;
    position: string;
    prompt: string;
  }): Promise<GeneratedImageAsset> {
    const output = await this.generateImage(input.prompt);
    const asset = await this.prisma.asset.create({
      data: {
        uploaderId: input.userId,
        fileName: `ai-${Date.now()}-${randomUUID().slice(0, 8)}.${output.extension}`,
        mimeType: output.mimeType,
        url: output.url,
        source: "ai_generated",
        auditStatus: AssetAuditStatus.pending,
        metadata: {
          prompt: input.prompt,
          position: input.position,
          model: this.model,
          provider: "volcengine-ark",
        },
      },
    });

    if (input.contentId) {
      await this.prisma.contentAsset
        .upsert({
          where: { contentId_assetId: { contentId: input.contentId, assetId: asset.id } },
          create: { contentId: input.contentId, assetId: asset.id },
          update: {},
        })
        .catch((error) => {
          this.logger.warn(`Generated image was created but not linked: ${(error as Error).message}`);
        });
    }

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
    };
  }

  private async generateImage(prompt: string) {
    this.assertConfigured();

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        size: this.imageSize,
        response_format: "url",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Ark image generation failed: ${response.status} - ${errorText}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const image = this.extractImage(payload);
    if (!image) {
      throw new Error("Ark image generation response did not contain an image URL or base64 payload");
    }

    return image;
  }

  private extractImage(payload: Record<string, unknown>) {
    const data = payload.data;
    if (Array.isArray(data)) {
      for (const item of data) {
        const image = this.extractImageFromAny(item);
        if (image) return image;
      }
    }

    return this.extractImageFromAny(payload);
  }

  private extractImageFromAny(value: unknown): { url: string; mimeType: string; extension: string } | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;

    const url = record.url;
    if (typeof url === "string" && url) {
      return { url, mimeType: this.mimeFromUrl(url), extension: this.extensionFromUrl(url) };
    }

    const base64 = record.b64_json ?? record.base64 ?? record.image_base64;
    if (typeof base64 === "string" && base64) {
      return {
        url: base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`,
        mimeType: "image/png",
        extension: "png",
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
      throw new Error(`Image generation is not configured: missing ${status.missing.join(", ")}`);
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
    const match = url.split("?")[0]?.match(/\.([a-zA-Z0-9]+)$/);
    return match?.[1]?.toLowerCase() || "png";
  }

  private mimeFromUrl(url: string) {
    const extension = this.extensionFromUrl(url);
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "webp") return "image/webp";
    return "image/png";
  }

  private describeImageUrl(url: string) {
    if (url.startsWith("data:")) return `data URL (${url.length} chars)`;
    return url.length > 140 ? `${url.slice(0, 140)}...` : url;
  }
}
