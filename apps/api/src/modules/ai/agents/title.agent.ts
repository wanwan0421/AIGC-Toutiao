import { Injectable } from "@nestjs/common";
import type { TitleGenerateRequest, TitleGenerateResult } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { ModelClientService } from "../model-client.service";
import { PromptTemplateService } from "../prompt-template.service";
import { AI_PROMPT_NAMES } from "../prompt-names";
import { parseJsonObject } from "../structured-output";

@Injectable()
export class TitleAgent {
  constructor(
    private readonly modelClient: ModelClientService,
    private readonly prompts: PromptTemplateService,
    private readonly logs: AiCallLogService
  ) {}

  async run(input: TitleGenerateRequest): Promise<TitleGenerateResult> {
    const startedAt = Date.now();
    const { prompt, model } = await this.prompts.render(
      AI_PROMPT_NAMES.titleGenerate,
      input as unknown as Record<string, unknown>
    );

    const content = await this.modelClient.complete({
      model,
      temperature: 0.65,
      messages: [
        {
          role: "system",
          content: "你只基于当前作品内容生成中文标题候选，并严格返回 JSON。",
        },
        { role: "user", content: prompt },
      ],
    });

    const parsed = parseJsonObject<TitleGenerateResult>(content);
    if (!parsed?.candidates?.length) {
      throw new Error("title_generate returned invalid candidates");
    }

    await this.logs.log({
      scene: AI_PROMPT_NAMES.titleGenerate,
      model: this.modelClient.modelName(model),
      inputSummary: `${input.currentTitle ?? ""} / ${input.body.slice(0, 100)}`,
      output: parsed,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return parsed;
  }
}
