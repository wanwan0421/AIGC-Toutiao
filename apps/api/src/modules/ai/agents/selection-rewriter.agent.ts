import { Injectable } from "@nestjs/common";
import type { SelectionRewriteRequest, SelectionRewriteResult } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { ModelClientService } from "../model-client.service";
import { PromptTemplateService } from "../prompt-template.service";
import { selectionPromptName } from "../prompt-names";
import { promptTemperature } from "../prompt-model-options";
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
    const rendered = await this.prompts.render(
      selectionPromptName(input.action),
      input as unknown as Record<string, unknown>
    );
    const { prompt, model } = rendered;

    const content = await this.modelClient.complete({
      model,
      temperature: promptTemperature(rendered.modelOptions, 0.55),
      messages: [
        {
          role: "system",
          content: "你只改写用户选中的文本，不额外解释，并严格返回 JSON。",
        },
        { role: "user", content: prompt },
      ],
    });

    const parsed = parseJsonObject<SelectionRewriteResult>(content);
    if (!parsed?.replacement) {
      throw new Error("selection rewrite returned invalid replacement");
    }

    await this.logs.log({
      scene: selectionPromptName(input.action),
      model: this.modelClient.modelName(model),
      inputSummary: input.selectedText.slice(0, 120),
      output: parsed,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return parsed;
  }
}
