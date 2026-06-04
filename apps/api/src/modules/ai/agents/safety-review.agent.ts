import { Injectable } from "@nestjs/common";
import {
  AuditRiskLevel,
  type AuditCategoryScores,
  type AuditRiskItem,
  type AuditRiskSeverity,
  type AuditResult,
  type AuditRiskType,
} from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { ModelClientService } from "../model-client.service";
import { AI_PROMPT_NAMES } from "../prompt-names";
import { PromptTemplateService } from "../prompt-template.service";
import { parseJsonObject } from "../structured-output";

const AUDIT_RISK_TYPES: AuditRiskType[] = [
  "pornography",
  "gambling",
  "drug",
  "sensitive",
  "vulgar",
  "privacy",
  "illegal",
  "fraud",
  "minor",
  "none",
];
const AUDIT_CATEGORY_TYPES = AUDIT_RISK_TYPES.filter((type) => type !== "none") as Exclude<AuditRiskType, "none">[];
const AUDIT_SEVERITIES: AuditRiskSeverity[] = ["low", "medium", "high"];

const SAFETY_REVIEW_FALLBACK_PROMPT = `你是中文内容安全审核专家，只负责判断内容是否合规，不做质量评分，也不做改写。
请重点识别涉黄、涉赌、涉毒、敏感信息、低俗表达、隐私泄露、违法交易、诈骗黑产、未成年人风险、夸大绝对化等风险。

标题：{{title}}
正文：{{body}}

规则引擎预检命中的候选风险片段如下，可能有误杀，请你复核，也要补充规则未命中的语义风险：
{{ruleRiskItemsJson}}

请只返回可解析 JSON，不要输出 Markdown 或额外解释。所有危险片段都放入 riskItems。confidence 为 0-1。
{
  "passed": false,
  "riskLevel": "high",
  "riskTypes": ["gambling"],
  "categoryScores": {
    "pornography": 0,
    "gambling": 0.92,
    "drug": 0,
    "sensitive": 0.2,
    "vulgar": 0,
    "privacy": 0,
    "illegal": 0,
    "fraud": 0,
    "minor": 0
  },
  "riskItems": [
    {
      "id": "llm_1",
      "type": "gambling",
      "severity": "high",
      "confidence": 0.92,
      "evidence": "加我微信带你玩私彩",
      "reason": "包含赌博引流和收益诱导",
      "source": "llm",
      "field": "body",
      "suggestion": "删除赌博玩法、联系方式和收益承诺"
    }
  ],
  "reasons": ["存在赌博引流风险"],
  "rewriteAvailable": true
}`;

@Injectable()
export class SafetyReviewAgent {
  constructor(
    private readonly modelClient: ModelClientService,
    private readonly prompts: PromptTemplateService,
    private readonly logs: AiCallLogService
  ) {}

  async run(input: { title: string; body: string; ruleRiskItems?: AuditRiskItem[] }): Promise<AuditResult> {
    const startedAt = Date.now();
    const variables = {
      ...input,
      ruleRiskItemsJson: JSON.stringify(input.ruleRiskItems ?? [], null, 2),
    };
    const rendered = await this.prompts.render(AI_PROMPT_NAMES.safetyReview, variables, SAFETY_REVIEW_FALLBACK_PROMPT);
    const prompt = this.shouldUseFallback(rendered.prompt)
      ? this.interpolate(SAFETY_REVIEW_FALLBACK_PROMPT, variables)
      : rendered.prompt;

    try {
      const content = await this.modelClient.complete({
        model: rendered.model,
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
        model: this.modelClient.modelName(rendered.model),
        inputSummary: `${input.title} / ${input.body.slice(0, 120)}`,
        output: result,
        latencyMs: Date.now() - startedAt,
        success: true,
      });
      return result;
    } catch (error) {
      await this.logs.log({
        scene: AI_PROMPT_NAMES.safetyReview,
        model: this.modelClient.modelName(rendered.model),
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
    const riskItems = this.normalizeRiskItems(value.riskItems);
    const riskTypes = this.resolveRiskTypes(
      typeof value.passed === "boolean" ? value.passed : false,
      this.normalizeRiskTypes(value.riskTypes),
      riskItems
    );
    const passed =
      typeof value.passed === "boolean"
        ? value.passed
        : riskLevel === AuditRiskLevel.Low &&
          riskTypes.every((type) => type === "none") &&
          !riskItems.some((item) => item.severity === "medium" || item.severity === "high");

    return {
      passed,
      riskLevel,
      riskTypes,
      reasons: this.normalizeStringArray(
        value.reasons,
        passed ? ["未发现明显合规风险"] : ["存在需要处理的合规风险"]
      ),
      rewriteAvailable: Boolean(value.rewriteAvailable ?? !passed),
      riskItems,
      categoryScores: this.normalizeCategoryScores(value.categoryScores),
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

  private resolveRiskTypes(passed: boolean, riskTypes: AuditRiskType[], riskItems: AuditRiskItem[]): AuditRiskType[] {
    if (passed && riskItems.length === 0) return ["none"] as AuditRiskType[];
    const fromItems = riskItems
      .filter((item) => item.severity === "medium" || item.severity === "high")
      .map((item) => item.type)
      .filter((type): type is Exclude<AuditRiskType, "none"> => type !== "none");
    const merged = Array.from(new Set([...riskTypes.filter((type) => type !== "none"), ...fromItems]));
    return merged.length ? merged : ["none"];
  }

  private normalizeRiskItems(value: unknown): AuditRiskItem[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item, index) => this.normalizeRiskItem(item, index))
      .filter((item): item is AuditRiskItem => Boolean(item));
  }

  private normalizeRiskItem(value: unknown, index: number): AuditRiskItem | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const evidence = typeof record.evidence === "string" ? record.evidence.trim() : "";
    if (!evidence) return null;
    const type = AUDIT_RISK_TYPES.includes(record.type as AuditRiskType) && record.type !== "none"
      ? (record.type as AuditRiskType)
      : "sensitive";
    const severity = AUDIT_SEVERITIES.includes(record.severity as AuditRiskSeverity)
      ? (record.severity as AuditRiskSeverity)
      : "medium";
    const field = record.field === "title" || record.field === "body" ? record.field : undefined;
    const startOffset = typeof record.startOffset === "number" && Number.isFinite(record.startOffset) ? record.startOffset : undefined;
    const endOffset = typeof record.endOffset === "number" && Number.isFinite(record.endOffset) ? record.endOffset : undefined;

    return {
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `llm_${index + 1}`,
      type,
      severity,
      confidence: this.clampConfidence(record.confidence),
      evidence,
      reason: typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : "模型识别到潜在合规风险",
      source: "llm",
      field,
      startOffset,
      endOffset,
      ruleId: typeof record.ruleId === "string" ? record.ruleId : undefined,
      suggestion: typeof record.suggestion === "string" ? record.suggestion : undefined,
    };
  }

  private normalizeCategoryScores(value: unknown): AuditCategoryScores {
    if (!value || typeof value !== "object") return {};
    const record = value as Record<string, unknown>;
    return Object.fromEntries(AUDIT_CATEGORY_TYPES.map((type) => [type, this.clampConfidence(record[type])]));
  }

  private clampConfidence(value: unknown) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return 0.75;
    return Math.min(1, Math.max(0, Number(numeric.toFixed(2))));
  }

  private normalizeStringArray(value: unknown, fallback: string[]) {
    if (!Array.isArray(value)) return fallback;
    const list = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
    return list.length ? list : fallback;
  }

  private shouldUseFallback(prompt: string) {
    return !prompt.includes("riskItems") || /浣犳槸|歿|鍙繑|鏍囬|姝ｆ枃/.test(prompt);
  }

  private interpolate(template: string, variables: Record<string, unknown>) {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
      const value = key.split(".").reduce<unknown>((current, part) => {
        if (current && typeof current === "object" && part in current) {
          return (current as Record<string, unknown>)[part];
        }
        return undefined;
      }, variables);

      if (Array.isArray(value)) return value.join("\n");
      if (value === null || value === undefined) return "";
      return String(value);
    });
  }
}
