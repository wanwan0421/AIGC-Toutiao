import { Injectable } from "@nestjs/common";
import type { AuditResult, AuditRiskItem, ComplianceRewriteResult } from "@aicp/shared";
import { ComplianceRewriteAgent } from "../agents/compliance-rewrite.agent";
import { SafetyReviewAgent } from "../agents/safety-review.agent";
import { SafetyResultMerger } from "../safety/safety-result-merger.service";
import { SafetyRuleEngine } from "../safety/safety-rule-engine.service";
import { throwIfAborted } from "../../../common/app-error";

type ReviewInput = {
  title: string;
  body: string;
};

type RewriteInput = ReviewInput & {
  reasons?: string[];
  riskItems?: AuditRiskItem[];
};

type SafetyExecutionOptions = {
  signal?: AbortSignal;
  aiJobId?: string;
  contentId?: string;
  conversationId?: string;
};

@Injectable()
export class ContentSafetyUseCase {
  constructor(
    private readonly safetyRules: SafetyRuleEngine,
    private readonly safetyReview: SafetyReviewAgent,
    private readonly resultMerger: SafetyResultMerger,
    private readonly complianceRewrite: ComplianceRewriteAgent
  ) {}

  // 执行内容安全审核，返回审核结果
  async review(input: ReviewInput, options: SafetyExecutionOptions = {}): Promise<AuditResult> {
    throwIfAborted(options.signal);
    // 规则预检
    const ruleResult = this.safetyRules.scan(input);
    // LLM审核
    const llmResult = await this.safetyReview.run(
      {
        ...input,
        ruleRiskItems: ruleResult.riskItems,
      },
      options
    );
    return this.resultMerger.merge(ruleResult, llmResult, input);
  }

  // 执行合规改写
  rewrite(input: RewriteInput, options: SafetyExecutionOptions = {}): Promise<ComplianceRewriteResult> {
    return this.complianceRewrite.run(input, options);
  }

  // 执行内容安全审核，并在不通过时尝试进行合规改写
  async reviewWithRewrite(
    input: ReviewInput,
    options: SafetyExecutionOptions = {}
  ): Promise<{
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
    options: SafetyExecutionOptions = {}
  ): Promise<ComplianceRewriteResult | null> {
    try {
      return await this.rewrite(input, options);
    } catch {
      throwIfAborted(options.signal);
      return null;
    }
  }

}
