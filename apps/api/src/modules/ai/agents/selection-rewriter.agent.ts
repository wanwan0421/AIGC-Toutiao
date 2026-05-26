import { Injectable } from "@nestjs/common";
import type { SelectionRewriteRequest, SelectionRewriteResult } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { ModelClientService } from "../model-client.service";
import { PromptTemplateService } from "../prompt-template.service";
import { parseJsonObject } from "../structured-output";

@Injectable()
export class SelectionRewriterAgent {
  constructor(
    private readonly modelClient: ModelClientService,
    private readonly prompts: PromptTemplateService,
    private readonly logs: AiCallLogService
  ) {}

  async run(input: SelectionRewriteRequest): Promise<SelectionRewriteResult> {
    const startedAt = Date.now();
    const fallback = this.mock(input);
    const { prompt, model } = await this.prompts.render(
      `selection_${input.action}`,
      input as unknown as Record<string, unknown>,
      `你是中文图文编辑助手。请对选中文本执行 {{action}}。

选中文本：{{selectedText}}
周边上下文：{{surroundingContext}}
目标语气：{{tone}}

只返回 JSON：{"replacement":"替换后的文本"}`
    );

    const content = await this.modelClient.complete({
      model,
      temperature: 0.55,
      fallback: "",
      messages: [
        { role: "system", content: "你只改写用户选中的文本，不额外解释，并严格返回 JSON。" },
        { role: "user", content: prompt },
      ],
    });
    const parsed = content ? parseJsonObject<SelectionRewriteResult>(content) : null;
    const result = parsed?.replacement ? parsed : fallback;

    await this.logs.log({
      scene: `selection_${input.action}`,
      model: this.modelClient.modelName(model),
      inputSummary: input.selectedText.slice(0, 120),
      output: result,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return result;
  }

  private mock(input: SelectionRewriteRequest): SelectionRewriteResult {
    if (input.action === "expand") {
      return {
        replacement: `${input.selectedText}。可以进一步补充一个真实场景、一个具体问题和一个可执行建议，让读者更容易代入并采取行动。`,
      };
    }

    if (input.action === "tone") {
      return {
        replacement: `换成更${input.tone || "轻松自然"}的表达：${input.selectedText}`,
      };
    }

    return {
      replacement: input.selectedText
        .replace(/非常/g, "更")
        .replace(/特别/g, "比较")
        .replace(/一定/g, "可以尝试")
        .trim(),
    };
  }
}
