import { Injectable } from "@nestjs/common";
import type { AuditResult, ComplianceRewriteResult } from "@aicp/shared";
import { ComplianceRewriteAgent } from "../agents/compliance-rewrite.agent";
import { SafetyReviewAgent } from "../agents/safety-review.agent";

type ReviewInput = {
  title: string;
  body: string;
};

type RewriteInput = ReviewInput & {
  reasons?: string[];
};

@Injectable()
export class SafetyReviewSkill {
  constructor(
    private readonly safetyReview: SafetyReviewAgent,
    private readonly complianceRewrite: ComplianceRewriteAgent
  ) {}

  // 只组合安全审核与合规改写能力，不做质量评分、任务状态或数据库写入。
  review(input: ReviewInput): Promise<AuditResult> {
    return this.safetyReview.run(input);
  }

  rewrite(input: RewriteInput): Promise<ComplianceRewriteResult> {
    return this.complianceRewrite.run(input);
  }

  async reviewWithRewrite(input: ReviewInput): Promise<{
    audit: AuditResult;
    rewrite: ComplianceRewriteResult | null;
  }> {
    const audit = await this.review(input);
    if (audit.passed) {
      return { audit, rewrite: null };
    }

    return {
      audit,
      rewrite: await this.tryRewrite({ ...input, reasons: audit.reasons }),
    };
  }

  private async tryRewrite(input: RewriteInput): Promise<ComplianceRewriteResult | null> {
    try {
      return await this.rewrite(input);
    } catch {
      return null;
    }
  }
}
