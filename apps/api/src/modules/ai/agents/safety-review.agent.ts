import { Injectable } from "@nestjs/common";
import { AuditRiskLevel, type AuditRiskItem, type AuditResult } from "@aicp/shared";
import { ModelClientService } from "../model-client.service";
import { AI_PROMPT_NAMES } from "../prompt-names";
import { PromptTemplateService } from "../prompt-template.service";
import { promptTemperature } from "../prompt-model-options";
import { completeStructured } from "../structured-output";
import { safetyReviewOutputSchema } from "./safety-review.schema";

const SAFETY_REVIEW_FALLBACK_PROMPT = `你是严格的中文内容安全审核专家。请判断当前图文是否可以发布。你只做内容安全审核，不做质量评分，也不改写正文。

重点识别以下发布合规风险：
- 涉黄、涉赌、涉毒
- 敏感信息、站外引流、隐私泄露
- 低俗表达、违法交易、诈骗黑产
- 未成年人风险
- 夸大绝对化表达
- 其他会影响内容发布的安全风险

只返回可解析 JSON，不要输出 Markdown 或额外解释。必须返回如下结构：
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
      "evidence": "从标题或正文中原样复制的风险片段",
      "reason": "为什么该片段不合规",
      "source": "llm",
      "field": "body",
      "suggestion": "删除或改写该风险表达"
    }
  ],
  "reasons": ["阻断原因摘要"],
  "rewriteAvailable": true
}

如果内容不安全：
- passed 必须为 false。
- riskLevel 必须为 medium 或 high。
- riskTypes 不能只包含 "none"。
- 每个明确风险片段都必须放入 riskItems，evidence 必须从标题或正文中原样复制。

如果没有明显合规风险：
- passed 返回 true。
- riskLevel 返回 "low"。
- riskTypes 返回 ["none"]。
- riskItems 返回 []。
- categoryScores 尽量接近 0。
- rewriteAvailable 返回 false。`;

@Injectable()
export class SafetyReviewAgent {
  constructor(
    private readonly modelClient: ModelClientService,
    private readonly prompts: PromptTemplateService
  ) {}

  // LLM执行内容安全审核，返回审核结果
  async run(
    input: { title: string; body: string; ruleRiskItems?: AuditRiskItem[] },
    options: { signal?: AbortSignal; aiJobId?: string; contentId?: string; conversationId?: string } = {}
  ): Promise<AuditResult> {
    const rendered = await this.prompts.render(AI_PROMPT_NAMES.safetyReview, {}, SAFETY_REVIEW_FALLBACK_PROMPT);

    try {
      const messages = [
        { role: "system" as const, content: rendered.prompt },
        { role: "user" as const, content: this.userMessage(input) },
      ];
      const validated = await completeStructured({
        modelClient: this.modelClient,
        name: "safety_review",
        schema: safetyReviewOutputSchema,
        messages,
        model: rendered.model,
        telemetry: {
          scene: AI_PROMPT_NAMES.safetyReview,
          promptKey: rendered.promptKey,
          promptVersionId: rendered.promptVersionId,
          inputSummary: `${input.title} / ${input.body.slice(0, 120)}`,
          aiJobId: options.aiJobId,
          contentId: options.contentId,
          conversationId: options.conversationId,
        },
        temperature: promptTemperature(rendered.modelOptions, 0.15),
        signal: options.signal,
      });
      const result = {
        ...validated,
        riskLevel: validated.riskLevel as AuditRiskLevel,
        riskItems: validated.riskItems.map((item) => ({ ...item, startOffset: item.startOffset ?? undefined, endOffset: item.endOffset ?? undefined, suggestion: item.suggestion ?? undefined })),
      } as AuditResult;
      return result;
    } catch (error) {
      throw error;
    }
  }

  private userMessage(input: { title: string; body: string; ruleRiskItems?: AuditRiskItem[] }) {
    return JSON.stringify(
      {
        title: input.title,
        body: input.body,
        ruleRiskItems: input.ruleRiskItems ?? [],
      },
      null,
      2
    );
  }
}
