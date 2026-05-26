import { Injectable } from "@nestjs/common";
import type { DirectGenerateRequest, DirectGenerateResult } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { ModelClientService } from "../model-client.service";
import { PromptTemplateService } from "../prompt-template.service";
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
    const fallback = this.mock(input);
    const { prompt, model } = await this.prompts.render(
      "direct_generate",
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
      fallback: "",
      messages: [
        { role: "system", content: "你是一个严格输出 JSON 的中文图文创作智能体。" },
        { role: "user", content: prompt },
      ],
    });
    const parsed = content ? parseJsonObject<DirectGenerateResult>(content) : null;
    const result = this.normalize(parsed ?? fallback, fallback);

    await this.logs.log({
      scene: "direct_generate",
      model: this.modelClient.modelName(model),
      inputSummary: `${input.theme} / ${input.materialNotes?.slice(0, 80) ?? ""}`,
      output: result,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return result;
  }

  private normalize(value: DirectGenerateResult, fallback: DirectGenerateResult): DirectGenerateResult {
    return {
      title: value.title || fallback.title,
      titleCandidates: Array.isArray(value.titleCandidates) && value.titleCandidates.length ? value.titleCandidates : fallback.titleCandidates,
      bodyMarkdown: value.bodyMarkdown || fallback.bodyMarkdown,
      tags: Array.isArray(value.tags) ? value.tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)) : fallback.tags,
      coverSuggestion: value.coverSuggestion || fallback.coverSuggestion,
      imagePrompts: Array.isArray(value.imagePrompts) && value.imagePrompts.length ? value.imagePrompts : fallback.imagePrompts,
      outline: Array.isArray(value.outline) && value.outline.length ? value.outline : fallback.outline,
    };
  }

  private mock(input: DirectGenerateRequest): DirectGenerateResult {
    const theme = input.theme || "创作主题";
    const audience = input.audience || "目标读者";
    const viewpoint = input.viewpoint || "提供清晰、有价值、可执行的观点";
    const style = input.style || "真实、轻松、有方法感";

    return {
      title: `${theme}：给${audience}的一套实用方法`,
      titleCandidates: [
        { title: `${theme}不用想太多：一套清晰公式`, reason: "突出实用性和可复制性" },
        { title: `写给${audience}的${theme}指南`, reason: "目标读者明确，适合信息流" },
        { title: `把${theme}讲明白：从场景到行动`, reason: "结构感强，利于完读" },
      ],
      bodyMarkdown: `开头：很多人对「${theme}」有兴趣，但真正开始时容易卡在思路和结构上。\n\n核心观点：${viewpoint}。\n\n第一部分：先明确读者当下最真实的场景。对${audience}来说，内容要直接解决一个具体问题，而不是只停留在概念。\n\n第二部分：用一个可复用的方法框架展开。可以按照“痛点 - 方法 - 示例 - 行动建议”的顺序组织，让读者快速理解并愿意收藏。\n\n第三部分：补充素材和细节。结合你提供的素材，可以加入真实案例、数据、对比或图片建议，让内容更有可信度。\n\n结尾：好的图文不是把信息堆满，而是让读者读完后知道下一步可以怎么做。整体风格保持${style}。`,
      tags: [`#${theme}`, "#实用方法", "#创作灵感"],
      coverSuggestion: `建议使用与「${theme}」强相关、主体清晰、色彩明亮的图片作为封面。`,
      imagePrompts: [
        { position: "开头配图", prompt: `${theme}，真实生活场景，自然光，信息流封面，清晰主体` },
        { position: "方法段落", prompt: `${theme} 方法清单，干净背景，图文排版感` },
      ],
      outline: [
        { heading: "场景痛点", summary: `说明${audience}为什么需要这篇内容。` },
        { heading: "核心方法", summary: "给出可执行的步骤和判断标准。" },
        { heading: "素材延展", summary: "结合素材补充案例、图片和细节。" },
      ],
    };
  }
}
