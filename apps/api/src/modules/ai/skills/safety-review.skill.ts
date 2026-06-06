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
  async review(input: ReviewInput, options: { trustedContext?: string } = {}): Promise<AuditResult> {
    const ruleResult = this.safetyRules.scan(input);
    const llmResult = await this.safetyReview.run({
      ...input,
      ruleRiskItems: ruleResult.riskItems,
    }, options);
    return this.resultMerger.merge(ruleResult, llmResult, input);
  }

  rewrite(input: RewriteInput, options: { trustedContext?: string } = {}): Promise<ComplianceRewriteResult> {
    return this.complianceRewrite.run(input, options);
  }

  async reviewWithRewrite(input: ReviewInput, options: { trustedContext?: string } = {}): Promise<{
    audit: AuditResult;
    rewrite: ComplianceRewriteResult | null;
  }> {
    const audit = await this.review(input, options);
    if (audit.passed) {
      return { audit, rewrite: null };
    }

    return {
      audit,
      rewrite: await this.tryRewrite({ ...input, reasons: audit.reasons, riskItems: audit.riskItems }, options),
    };
  }

  private async tryRewrite(
    input: RewriteInput,
    options: { trustedContext?: string } = {}
  ): Promise<ComplianceRewriteResult | null> {
    try {
      return await this.rewrite(input, options);
    } catch {
      return null;
    }
  }
}
