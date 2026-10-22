import { Injectable, Logger } from "@nestjs/common";
import { AssetAuditStatus } from "@prisma/client";
import { ModelClientService } from "../ai/model-client.service";
import { completeStructured } from "../ai/structured-output";
import { imageModerationSchema } from "../ai/agents/structured-agent.schemas";
import { AppError } from "../../common/app-error";

export type ImageModerationResult = {
  auditStatus: AssetAuditStatus;
  auditReason: string | null;
  riskLevel: "unknown" | "low" | "medium" | "high";
  riskTypes: string[];
};

const moderationContract = [
  "Apply the platform's unified content-safety standard: pass only when there is no material policy risk; fail when a material risk is visible; when evidence is unclear, do not mark the image passed.",
  "Inspect visible evidence only. Do not infer intent or unseen context. Check visible sexual content, graphic violence, weapons, drugs, gambling, fraud/scams, politically sensitive imagery, and QR codes that visibly divert users to risky content.",
  "Return exactly one JSON object. pass is boolean; level is low, medium, or high; reason briefly identifies visible evidence; types contains only pornography, gambling, drug, sensitive, violence, fraud, or none. Use [none] only for a passing image.",
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

    const timeoutMs = this.modelClient.resolveTimeoutMs(process.env.IMAGE_MODERATION_TIMEOUT_MS, 45_000);
    const dataUri = `data:${input.mimeType};base64,${input.buffer.toString("base64")}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
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
          timeoutMs,
          repairAttempts: 0,
          messages: [
            { role: "system", content: moderationContract },
            { role: "user", content: [
              { type: "image_url", image_url: { url: dataUri } },
              { type: "text", text: "请按审核标准检查这张图片，并仅依据图片中实际可见的内容给出结构化结论。" },
            ] },
          ],
        });

        return {
          auditStatus: value.pass ? AssetAuditStatus.approved : AssetAuditStatus.rejected,
          auditReason: value.reason,
          riskLevel: value.level,
          riskTypes: value.types.filter((type) => type !== "none"),
        };
      } catch (error) {
        const retryable = !(error instanceof AppError) || error.retryable || error.code === "UPSTREAM_INVALID_RESPONSE";
        if (attempt === 0 && retryable && input.signal?.aborted !== true) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          continue;
        }
        this.logger.warn(`Image moderation unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return this.pendingResult();
      }
    }
    return this.pendingResult();
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
