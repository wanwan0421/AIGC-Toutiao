import { Injectable, Logger } from "@nestjs/common";
import type { DirectGenerateRequest, DirectGenerateResult } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { ModelClientService } from "../model-client.service";
import { PromptTemplateService } from "../prompt-template.service";
import { AI_PROMPT_NAMES } from "../prompt-names";
import { promptTemperature } from "../prompt-model-options";
import { parseJsonObject } from "../structured-output";

@Injectable()
export class DraftGeneratorAgent {
  private readonly logger = new Logger(DraftGeneratorAgent.name);

  constructor(
    private readonly modelClient: ModelClientService,
    private readonly prompts: PromptTemplateService,
    private readonly logs: AiCallLogService
  ) {}

  async run(input: DirectGenerateRequest): Promise<DirectGenerateResult> {
    const startedAt = Date.now();
    // 渲染结构化图文创作提示词，模型结果只负责内容，不处理任务进度。
    const rendered = await this.prompts.render(
      AI_PROMPT_NAMES.directGenerate,
      input as unknown as Record<string, unknown>
    );
    const { prompt, model } = rendered;

    const content = await this.modelClient.complete({
      model,
      temperature: promptTemperature(rendered.modelOptions, 0.75),
      messages: [
        {
          role: "system",
          content: "你是一个严格输出 JSON 的中文图文创作智能体，不要输出推理过程或多余说明。",
        },
        { role: "user", content: prompt },
      ],
    });
    this.logger.log(`Direct generate model output received: ${content.length} chars`);

    const parsed = parseJsonObject<DirectGenerateResult>(content);
    if (!parsed) {
      throw new Error("direct_generate returned invalid JSON");
    }
    const result = this.normalize(parsed);

    await this.logs.log({
      scene: AI_PROMPT_NAMES.directGenerate,
      model: this.modelClient.modelName(model),
      inputSummary: `${input.theme} / ${input.materialNotes?.slice(0, 80) ?? ""}`,
      output: result,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return result;
  }

  private normalize(value: DirectGenerateResult): DirectGenerateResult {
    if (!value.title || !value.bodyMarkdown) {
      throw new Error("direct_generate result missing title or bodyMarkdown");
    }

    return {
      title: value.title,
      titleCandidates: Array.isArray(value.titleCandidates) ? value.titleCandidates : [],
      bodyMarkdown: value.bodyMarkdown,
      tags: Array.isArray(value.tags) ? value.tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)) : [],
      coverSuggestion: value.coverSuggestion ?? "",
      imagePrompts: Array.isArray(value.imagePrompts) ? value.imagePrompts : [],
      imageAssets: [],
      outline: Array.isArray(value.outline) ? value.outline : [],
    };
  }
}
