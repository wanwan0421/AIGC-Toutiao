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
      messages: [
        { role: "system", content: "你只改写用户选中的文本，不额外解释，并严格返回 JSON。" },
        { role: "user", content: prompt },
      ],
    });
    const parsed = content ? parseJsonObject<SelectionRewriteResult>(content) : null;
    if (!parsed?.replacement) {
      throw new Error("selection rewrite returned invalid replacement");
    }
    const result = parsed;

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
}
