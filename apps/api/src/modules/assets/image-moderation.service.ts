import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AssetAuditStatus } from "@prisma/client";

export type ImageModerationResult = {
  auditStatus: AssetAuditStatus;
  auditReason: string | null;
  riskLevel: "unknown" | "low" | "medium" | "high";
  riskTypes: string[];
};

@Injectable()
export class ImageModerationService {
  constructor(private readonly config: ConfigService) {}

  async reviewImage(): Promise<ImageModerationResult> {
    const provider = this.config.get<string>("IMAGE_MODERATION_PROVIDER")?.trim();
    if (!provider) {
      return {
        auditStatus: AssetAuditStatus.pending,
        auditReason: "图片基础规则通过，语义审核待接入视觉审核模型",
        riskLevel: "unknown",
        riskTypes: [],
      };
    }

    return {
      auditStatus: AssetAuditStatus.pending,
      auditReason: `图片基础规则通过，视觉审核 provider(${provider}) 适配器待启用`,
      riskLevel: "unknown",
      riskTypes: [],
    };
  }
}
