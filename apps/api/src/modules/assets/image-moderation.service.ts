import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AssetAuditStatus } from "@prisma/client";
import { SafetyRuleEngine } from "../ai/safety/safety-rule-engine.service";
import { ModelClientService } from "../ai/model-client.service";

export type ImageModerationResult = {
  auditStatus: AssetAuditStatus;
  auditReason: string | null;
  riskLevel: "unknown" | "low" | "medium" | "high";
  riskTypes: string[];
};

@Injectable()
export class ImageModerationService {
  private readonly logger = new Logger(ImageModerationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly safetyRuleEngine: SafetyRuleEngine,
    private readonly modelClient: ModelClientService,
  ) {}

  // 图片审核
  async reviewImage(options?: { fileName?: string; imageDesc?: string }): Promise<ImageModerationResult> {
    const fileName = options?.fileName ?? "";
    const imageDesc = options?.imageDesc ?? "";

    // 全量结构化扫描
    const baseScanResult = this.performBaseSafetyScan(fileName, imageDesc);
    if (baseScanResult.auditStatus === AssetAuditStatus.rejected) {
      return baseScanResult;
    }

    if (this.modelClient.hasRemoteProvider()) {
      try {
        // 调用LLM模型审核
        const llmResult = await this.performLlmImageAudit(fileName, imageDesc);
        if (llmResult.auditStatus === AssetAuditStatus.rejected) {
          return llmResult;
        }
        return llmResult;
      } catch (error) {
        this.logger.warn(`LLM image audit skipped: ${(error as Error).message}`);
      }
    }

    return {
      auditStatus: AssetAuditStatus.approved,
      auditReason: "图片基础规则审核通过",
      riskLevel: "low",
      riskTypes: [],
    };
  }

  // 全量结构化扫描，判断是否包含违规内容
  private performBaseSafetyScan(fileName: string, imageDesc: string): ImageModerationResult {
    const combinedText = `${fileName}\n${imageDesc}`;
    const scanResult = this.safetyRuleEngine.scan({
      title: combinedText,
      body: "",
    });

    const blockingRisks = scanResult.riskItems.filter(
      (item) => item.severity === "medium" || item.severity === "high",
    );

    if (blockingRisks.length > 0) {
      return {
        auditStatus: AssetAuditStatus.rejected,
        auditReason: `图片元数据/描述命中安全风险：${blockingRisks.map((r) => r.reason).join("；")}`,
        riskLevel: scanResult.riskLevel,
        riskTypes: scanResult.riskTypes,
      };
    }

    return {
      auditStatus: AssetAuditStatus.approved,
      auditReason: null,
      riskLevel: "low",
      riskTypes: [],
    };
  }

  private async performLlmImageAudit(fileName: string, imageDesc: string): Promise<ImageModerationResult> {
    const contentToAudit = [
      fileName ? `文件名：${fileName}` : "",
      imageDesc ? `图片内容描述：${imageDesc}` : "",
    ].filter(Boolean).join("\n");

    const response = await this.modelClient.complete({
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `你是专业的内容安全审核员。你的任务是审核用户上传的图片相关信息，判断是否包含违规内容。

审核标准：
- 包含色情、裸露、性行为内容 → 违规 high
- 包含赌博、博彩、赌场、彩票内容 → 违规 high
- 包含毒品、吸毒、违禁药品内容 → 违规 high
- 包含政治敏感人物、违规政治宣传内容 → 违规 high
- 包含暴力、血腥、武器、暴恐场景 → 违规 medium/high
- 包含诈骗、导流、二维码、站外联系方式 → 违规 medium
- 正常风景、人物肖像、日常生活照片 → 合规 low

请严格按照JSON格式返回：
{"pass": true/false, "level": "low"|"medium"|"high", "reason": "审核说明", "types": ["pornography", "gambling", "drug", "sensitive", "violence", "fraud", "none"]}
不要返回任何额外解释文字。`
        },
        {
          role: "user",
          content: `现在审核以下图片内容：
${contentToAudit}
请直接输出JSON结果。`
        },
      ],
    });

    try {
      const jsonText = response.trim().replace(/^```json\s*/, "").replace(/\s*```$/, "");
      const result = JSON.parse(jsonText) as {
        pass: boolean;
        level: "low" | "medium" | "high";
        reason: string;
        types: string[];
      };

      if (!result.pass) {
        return {
          auditStatus: AssetAuditStatus.rejected,
          auditReason: result.reason || "LLM 内容安全审核不通过",
          riskLevel: result.level,
          riskTypes: result.types?.filter((t) => t !== "none") ?? [],
        };
      }

      return {
        auditStatus: AssetAuditStatus.approved,
        auditReason: result.reason || "图片审核通过",
        riskLevel: result.level,
        riskTypes: result.types ?? [],
      };
    } catch (parseError) {
      this.logger.warn(`LLM image audit JSON parse failed, raw: ${response.slice(0, 200)}`);
      return {
        auditStatus: AssetAuditStatus.approved,
        auditReason: "基础规则审核通过，LLM复核结果跳过",
        riskLevel: "low",
        riskTypes: [],
      };
    }
  }
}
