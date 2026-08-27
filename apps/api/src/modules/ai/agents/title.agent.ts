import { Injectable } from "@nestjs/common";
import type { TitleGenerateRequest, TitleGenerateResult } from "@aicp/shared";
import { ModelClientService } from "../model-client.service";
import { PromptTemplateService } from "../prompt-template.service";
import { AI_PROMPT_NAMES } from "../prompt-names";
import { promptTemperature } from "../prompt-model-options";
import { completeStructured } from "../structured-output";
import { titleGenerateSchema } from "./structured-agent.schemas";

@Injectable()
export class TitleAgent {
  constructor(
    private readonly modelClient: ModelClientService,
    private readonly prompts: PromptTemplateService
  ) {}

  async run(input: TitleGenerateRequest, options: { signal?: AbortSignal; aiJobId?: string; contentId?: string; conversationId?: string } = {}): Promise<TitleGenerateResult> {
    const rendered = await this.prompts.render(
      AI_PROMPT_NAMES.titleGenerate,
      input as unknown as Record<string, unknown>
    );
    const { prompt, model } = rendered;

    const parsed = await completeStructured({
      modelClient: this.modelClient,
      name: "title_generate",
      schema: titleGenerateSchema,
      model,
      telemetry: {
        scene: AI_PROMPT_NAMES.titleGenerate,
        promptKey: rendered.promptKey,
        promptVersionId: rendered.promptVersionId,
        inputSummary: `${input.currentTitle ?? ""} / ${input.body.slice(0, 100)}`,
        aiJobId: options.aiJobId,
        contentId: options.contentId,
        conversationId: options.conversationId,
      },
      temperature: promptTemperature(rendered.modelOptions, 0.65),
      thinking: "disabled",
      signal: options.signal,
      messages: [
        {
          role: "system",
          content: "你只基于当前作品内容生成中文标题候选，并严格返回 JSON。",
        },
        { role: "user", content: prompt },
      ],
    });

    return parsed;
  }
}
