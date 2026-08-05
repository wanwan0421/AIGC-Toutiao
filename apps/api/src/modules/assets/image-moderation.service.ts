import { Injectable, Logger } from "@nestjs/common";
import { AssetAuditStatus } from "@prisma/client";
import { z } from "zod";
import { ModelClientService } from "../ai/model-client.service";

export type ImageModerationResult = {
  auditStatus: AssetAuditStatus;
  auditReason: string | null;
  riskLevel: "unknown" | "low" | "medium" | "high";
  riskTypes: string[];
};

const resultSchema = z.object({
  pass: z.boolean(),
  level: z.enum(["low", "medium", "high"]),
  reason: z.string().max(500),
  types: z.array(z.enum(["pornography", "gambling", "drug", "sensitive", "violence", "fraud", "none"])).max(8),
}).strict();

@Injectable()
export class ImageModerationService {
  private readonly logger = new Logger(ImageModerationService.name);
  constructor(private readonly modelClient: ModelClientService) {}

  async reviewImage(input: { buffer: Buffer; mimeType: string; fileName?: string; signal?: AbortSignal }): Promise<ImageModerationResult> {
    if (!this.modelClient.hasRemoteProvider()) {
      return { auditStatus: AssetAuditStatus.pending, auditReason: "图片内容审核服务暂不可用", riskLevel: "unknown", riskTypes: [] };
    }
    try {
      // The vision model receives the actual decoded image bytes. The second
      // strict pass turns its description into a stable moderation contract.
      const description = await this.modelClient.describeImage(
        input.buffer,
        input.mimeType,
        "详细描述图片中的人物、裸露、暴力、武器、毒品、赌博、二维码、文字和其他安全风险。",
        input.signal,
      );
      if (!description.trim()) throw new Error("empty visual moderation description");
      const raw = await this.modelClient.complete({
        temperature: 0.1,
        signal: input.signal,
        messages: [
          { role: "system", content: "你是图片安全审核器。仅返回单个 JSON 对象，字段严格为 pass, level, reason, types。色情、暴力、武器、毒品、赌博、诈骗、政治敏感或导流二维码不得通过。" },
          { role: "user", content: `文件名：${input.fileName ?? ""}\n视觉模型描述：${description}` },
        ],
      });
      const parsed = resultSchema.parse(JSON.parse(raw.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "")));
      return {
        auditStatus: parsed.pass ? AssetAuditStatus.approved : AssetAuditStatus.rejected,
        auditReason: parsed.reason,
        riskLevel: parsed.level,
        riskTypes: parsed.types.filter((type) => type !== "none"),
      };
    } catch (error) {
      this.logger.warn(`Image moderation unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { auditStatus: AssetAuditStatus.pending, auditReason: "图片内容审核未完成，等待重试", riskLevel: "unknown", riskTypes: [] };
    }
  }
}
