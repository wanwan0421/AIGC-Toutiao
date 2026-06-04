import { Injectable } from "@nestjs/common";
import type { AuditResult, AuditRiskItem, ComplianceRewriteResult } from "@aicp/shared";
import { ComplianceRewriteAgent } from "../agents/compliance-rewrite.agent";
import { SafetyReviewAgent } from "../agents/safety-review.agent";
import { SafetyResultMerger } from "../safety/safety-result-merger.service";
import { SafetyRuleEngine } from "../safety/safety-rule-engine.service";

type ReviewInput = {
  title: string;
  body: string;
};

type RewriteInput = ReviewInput & {
  reasons?: string[];
  riskItems?: AuditRiskItem[];
};

@Injectable()
export class SafetyReviewSkill {
  constructor(
    private readonly safetyRules: SafetyRuleEngine,
    private readonly safetyReview: SafetyReviewAgent,
    private readonly resultMerger: SafetyResultMerger,
    private readonly complianceRewrite: ComplianceRewriteAgent
  ) {}

  // Skill 只组合安全规则与模型能力，不写任务状态或数据库。
  async review(input: ReviewInput): Promise<AuditResult> {
    const ruleResult = this.safetyRules.scan(input);
    const llmResult = await this.safetyReview.run({
      ...input,
      ruleRiskItems: ruleResult.riskItems,
    });
    return this.resultMerger.merge(ruleResult, llmResult, input);
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
      rewrite: await this.tryRewrite({ ...input, reasons: audit.reasons, riskItems: audit.riskItems }),
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
