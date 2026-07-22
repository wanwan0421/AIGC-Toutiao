import { Injectable } from "@nestjs/common";
import type { QualityScoreResult } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { ModelClientService } from "../model-client.service";
import { AI_PROMPT_NAMES } from "../prompt-names";
import { PromptTemplateService } from "../prompt-template.service";
import { promptTemperature } from "../prompt-model-options";
import { parseJsonObject } from "../structured-output";

const QUALITY_SCORE_FALLBACK_PROMPT = `你是中文图文内容质量评估专家，只负责多维质量评分，不做安全审核，也不做改写。

标题：{{title}}
正文：{{body}}

请从五个维度评分，每个维度 0-20 分，总分 0-100：
1. structure：结构完整度
2. clarity：表达清晰度
3. value：信息价值
4. attraction：标题与内容吸引力
5. compliance：合规表达质量

只返回 JSON，不要输出 Markdown 或额外解释：
{
  "total": 86,
  "dimensions": {
    "structure": 18,
    "clarity": 17,
    "value": 18,
    "attraction": 16,
    "compliance": 17
  },
  "reason": "结构完整，表达清晰，具备发布基础"
}`;

@Injectable()
export class QualityScoringAgent {
  constructor(
    private readonly modelClient: ModelClientService,
    private readonly prompts: PromptTemplateService,
    private readonly logs: AiCallLogService
  ) {}

  async run(input: { title: string; body: string }, options: { signal?: AbortSignal } = {}): Promise<QualityScoreResult> {
    const startedAt = Date.now();
    const rendered = await this.prompts.render(AI_PROMPT_NAMES.qualityScore, input, QUALITY_SCORE_FALLBACK_PROMPT);
    const { prompt, model } = rendered;

    try {
      const content = await this.modelClient.complete({
        model,
        temperature: promptTemperature(rendered.modelOptions, 0.25),
        messages: [
          {
            role: "system",
            content: "你是严格的中文内容质量评分模型。只输出可解析 JSON，不输出推理过程。",
          },
          { role: "user", content: prompt },
        ],
        signal: options.signal,
      });
      const parsed = parseJsonObject<Partial<QualityScoreResult>>(content);
      if (!parsed) {
        throw new Error("quality_score returned invalid JSON");
      }

      const result = this.normalize(parsed);
      await this.logs.log({
        scene: AI_PROMPT_NAMES.qualityScore,
        model: this.modelClient.modelName(model),
        promptKey: rendered.promptKey,
        promptVersionId: rendered.promptVersionId,
        inputSummary: `${input.title} / ${input.body.slice(0, 120)}`,
        output: result,
        latencyMs: Date.now() - startedAt,
        success: true,
      });
      return result;
    } catch (error) {
      await this.logs.log({
        scene: AI_PROMPT_NAMES.qualityScore,
        model: this.modelClient.modelName(model),
        promptKey: rendered.promptKey,
        promptVersionId: rendered.promptVersionId,
        inputSummary: `${input.title} / ${input.body.slice(0, 120)}`,
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: error instanceof Error ? error.message : "unknown quality score error",
      });
      throw error;
    }
  }

  private normalize(value: Partial<QualityScoreResult>): QualityScoreResult {
    const dimensions = {
      structure: this.clampScore(value.dimensions?.structure),
      clarity: this.clampScore(value.dimensions?.clarity),
      value: this.clampScore(value.dimensions?.value),
      attraction: this.clampScore(value.dimensions?.attraction),
      compliance: this.clampScore(value.dimensions?.compliance),
    };
    const summed = Object.values(dimensions).reduce((sum, item) => sum + item, 0);
    const total = this.clampScore(value.total, 100) || summed;

    return {
      total,
      dimensions,
      reason:
        typeof value.reason === "string" && value.reason.trim()
          ? value.reason.trim()
          : "AI 已完成结构、表达、价值、吸引力与合规表达质量评分。",
    };
  }

  private clampScore(value: unknown, max = 20) {
    const numberValue = typeof value === "number" ? value : Number(value ?? 0);
    if (!Number.isFinite(numberValue)) return 0;
    return Math.max(0, Math.min(max, Math.round(numberValue)));
  }
}
