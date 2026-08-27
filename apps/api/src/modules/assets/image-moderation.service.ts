import { Injectable, Logger } from "@nestjs/common";
import { AssetAuditStatus } from "@prisma/client";
import { ModelClientService } from "../ai/model-client.service";
import { completeStructured } from "../ai/structured-output";
import { imageModerationSchema } from "../ai/agents/structured-agent.schemas";

export type ImageModerationResult = {
  auditStatus: AssetAuditStatus;
  auditReason: string | null;
  riskLevel: "unknown" | "low" | "medium" | "high";
  riskTypes: string[];
};

const moderationContract = [
  "You are an image safety moderation classifier. Return exactly one JSON object and no other text.",
  "Allowed fields: pass, level, reason, types. Unknown fields are forbidden.",
  'pass must be boolean. level must be exactly one of: "low", "medium", "high".',
  'types must contain only: "pornography", "gambling", "drug", "sensitive", "violence", "fraud", "none".',
  'For an approved image use types ["none"]. Unsafe sexual, violent, weapon, drug, gambling, fraud, politically sensitive, or diversion QR-code content must not pass.',
  'Approved example: {"pass":true,"level":"low","reason":"No material safety risk detected","types":["none"]}',
  'Rejected example: {"pass":false,"level":"high","reason":"Graphic violence is visible","types":["violence"]}',
].join("\n");

@Injectable()
export class ImageModerationService {
  private readonly logger = new Logger(ImageModerationService.name);

  constructor(private readonly modelClient: ModelClientService) {}

  async reviewImage(input: {
    buffer: Buffer;
    mimeType: string;
    fileName?: string;
    signal?: AbortSignal;
    aiJobId?: string;
    contentId?: string;
    conversationId?: string;
  }): Promise<ImageModerationResult> {
    if (!this.modelClient.hasRemoteProvider()) {
      return this.pendingResult("图片内容审核服务暂不可用");
    }

    try {
      const description = await this.modelClient.describeImage(
        input.buffer,
        input.mimeType,
        "详细描述图片中的人物、裸露、暴力、武器、毒品、赌博、二维码、文字和其他安全风险。",
        input.signal,
        {
          aiJobId: input.aiJobId,
          contentId: input.contentId,
          conversationId: input.conversationId,
          inputSummary: input.fileName,
        },
      );
      if (!description.trim()) throw new Error("empty visual moderation description");

      const value = await completeStructured({
        modelClient: this.modelClient, name: "image_moderation", schema: imageModerationSchema,
        temperature: 0.1,
        telemetry: {
          scene: "image_moderation",
          aiJobId: input.aiJobId,
          contentId: input.contentId,
          conversationId: input.conversationId,
          inputSummary: input.fileName,
        },
        signal: input.signal,
        messages: [
          { role: "system", content: moderationContract },
          { role: "user", content: `文件名：${input.fileName ?? ""}\n视觉模型描述：${description}` },
        ],
      });

      return {
        auditStatus: value.pass ? AssetAuditStatus.approved : AssetAuditStatus.rejected,
        auditReason: value.reason,
        riskLevel: value.level,
        riskTypes: value.types.filter((type) => type !== "none"),
      };
    } catch (error) {
      this.logger.warn(`Image moderation unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return this.pendingResult();
    }
  }

  private pendingResult(reason = "图片内容审核未完成，等待重试"): ImageModerationResult {
    return {
      auditStatus: AssetAuditStatus.pending,
      auditReason: reason,
      riskLevel: "unknown",
      riskTypes: [],
    };
  }
}
