import { Injectable } from "@nestjs/common";
import type { DirectGenerateRequest, DirectGenerateResult } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { ModelClientService } from "../model-client.service";
import { PromptTemplateService } from "../prompt-template.service";
import { AI_PROMPT_NAMES } from "../prompt-names";
import { parseJsonObject } from "../structured-output";

@Injectable()
export class DraftGeneratorAgent {
  constructor(
    private readonly modelClient: ModelClientService,
    private readonly prompts: PromptTemplateService,
    private readonly logs: AiCallLogService
  ) {}

  async run(input: DirectGenerateRequest): Promise<DirectGenerateResult> {
    const startedAt = Date.now();
    const { prompt, model } = await this.prompts.render(
      AI_PROMPT_NAMES.directGenerate,
      input as unknown as Record<string, unknown>,
      `你是今日头条图文创作助手。请根据用户提供的前置需求生成结构完整、表达丰富的图文草稿。

主题：{{theme}}
目标人群：{{audience}}
风格：{{style}}
核心观点：{{viewpoint}}
素材参考：{{materialNotes}}

只返回 JSON，字段必须包含：
title, titleCandidates, bodyMarkdown, tags, coverSuggestion, imagePrompts, outline。`
    );

    const content = await this.modelClient.complete({
      model,
      temperature: 0.75,
      messages: [
        { role: "system", content: "你是一个严格输出 JSON 的中文图文创作智能体。" },
        { role: "user", content: prompt },
      ],
    });
    const parsed = content ? parseJsonObject<DirectGenerateResult>(content) : null;
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
