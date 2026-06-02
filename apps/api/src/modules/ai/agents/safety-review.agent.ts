import { Injectable } from "@nestjs/common";
import { AuditRiskLevel, type AuditResult, type AuditRiskType } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { ModelClientService } from "../model-client.service";
import { AI_PROMPT_NAMES } from "../prompt-names";
import { PromptTemplateService } from "../prompt-template.service";
import { parseJsonObject } from "../structured-output";

const AUDIT_RISK_TYPES: AuditRiskType[] = ["pornography", "gambling", "drug", "sensitive", "vulgar", "privacy", "none"];

const SAFETY_REVIEW_FALLBACK_PROMPT = `你是中文内容安全审核专家，只负责判断内容是否合规，不做质量评分，也不做改写。

标题：{{title}}
正文：{{body}}

请检查涉黄、赌博、毒品、敏感信息、低俗表达、隐私泄露、夸大绝对化等风险。
只返回 JSON，不要输出 Markdown 或额外解释：
{
  "passed": true,
  "riskLevel": "low",
  "riskTypes": ["none"],
  "reasons": ["未发现明显合规风险"],
  "rewriteAvailable": false
}`;

@Injectable()
export class SafetyReviewAgent {
  constructor(
    private readonly modelClient: ModelClientService,
    private readonly prompts: PromptTemplateService,
    private readonly logs: AiCallLogService
  ) {}

  async run(input: { title: string; body: string }): Promise<AuditResult> {
    const startedAt = Date.now();
    const { prompt, model } = await this.prompts.render(AI_PROMPT_NAMES.safetyReview, input, SAFETY_REVIEW_FALLBACK_PROMPT);

    try {
      const content = await this.modelClient.complete({
        model,
        temperature: 0.15,
        messages: [
          {
            role: "system",
            content: "你是严格的中文内容安全审核模型。只输出可解析 JSON，不输出推理过程。",
          },
          { role: "user", content: prompt },
        ],
      });
      const parsed = parseJsonObject<Partial<AuditResult>>(content);
      if (!parsed) {
        throw new Error("safety_review returned invalid JSON");
      }

      const result = this.normalize(parsed);
      await this.logs.log({
        scene: AI_PROMPT_NAMES.safetyReview,
        model: this.modelClient.modelName(model),
        inputSummary: `${input.title} / ${input.body.slice(0, 120)}`,
        output: result,
        latencyMs: Date.now() - startedAt,
        success: true,
      });
      return result;
    } catch (error) {
      await this.logs.log({
        scene: AI_PROMPT_NAMES.safetyReview,
        model: this.modelClient.modelName(model),
        inputSummary: `${input.title} / ${input.body.slice(0, 120)}`,
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: error instanceof Error ? error.message : "unknown safety review error",
      });
      throw error;
    }
  }

  private normalize(value: Partial<AuditResult>): AuditResult {
    const riskLevel = this.normalizeRiskLevel(value.riskLevel);
    const riskTypes = this.normalizeRiskTypes(value.riskTypes);
    const passed =
      typeof value.passed === "boolean"
        ? value.passed
        : riskLevel === AuditRiskLevel.Low && riskTypes.every((type) => type === "none");

    return {
      passed,
      riskLevel,
      riskTypes: passed && riskTypes.length === 0 ? ["none"] : riskTypes,
      reasons: this.normalizeStringArray(
        value.reasons,
        passed ? ["未发现明显合规风险"] : ["存在需要人工确认的合规风险"]
      ),
      rewriteAvailable: Boolean(value.rewriteAvailable ?? !passed),
    };
  }

  private normalizeRiskLevel(value: unknown): AuditRiskLevel {
    if (value === AuditRiskLevel.High || value === "high") return AuditRiskLevel.High;
    if (value === AuditRiskLevel.Medium || value === "medium") return AuditRiskLevel.Medium;
    return AuditRiskLevel.Low;
  }

  private normalizeRiskTypes(value: unknown): AuditRiskType[] {
    const list = Array.isArray(value) ? value : [];
    const normalized = list.filter((item): item is AuditRiskType => AUDIT_RISK_TYPES.includes(item as AuditRiskType));
    return normalized.length ? normalized : ["none"];
  }

  private normalizeStringArray(value: unknown, fallback: string[]) {
    if (!Array.isArray(value)) return fallback;
    const list = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
    return list.length ? list : fallback;
  }
}
