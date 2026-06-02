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
    // 获取提示词模板并渲染
    const { prompt, model } = await this.prompts.render(
      AI_PROMPT_NAMES.directGenerate,
      input as unknown as Record<string, unknown>
    );

    // 调LLM接口获取结果，要求必须是 JSON 格式
    const content = await this.modelClient.complete({
      model,
      temperature: 0.75,
      messages: [
        {
          role: "system",
          content: "你是一个严格输出 JSON 的中文图文创作智能体，不要输出推理过程或多余说明。",
        },
        { role: "user", content: prompt },
      ],
    });

    console.log("获取到原始输出", { content });

    // 解析结果并规范化为预期格式，必要时进行修正
    const parsed = parseJsonObject<DirectGenerateResult>(content);
    if (!parsed) {
      throw new Error("direct_generate returned invalid JSON");
    }
    const result = this.normalize(parsed);

    // 记录调用日志
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
