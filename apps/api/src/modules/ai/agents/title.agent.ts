import { Injectable } from "@nestjs/common";
import type { TitleGenerateRequest, TitleGenerateResult } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { ModelClientService } from "../model-client.service";
import { PromptTemplateService } from "../prompt-template.service";
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
    const fallback = this.mock(input);
    const { prompt, model } = await this.prompts.render(
      "title_generate",
      input as unknown as Record<string, unknown>,
      `你是今日头条标题优化助手。只能根据当前标题和正文生成标题候选，不要使用用户未提供的主题、目标人群或风格。

当前标题：{{currentTitle}}
正文：{{body}}

只返回 JSON：{"candidates":[{"title":"标题","reason":"推荐理由"}]}`
    );

    const content = await this.modelClient.complete({
      model,
      temperature: 0.65,
      fallback: "",
      messages: [
        { role: "system", content: "你只基于当前作品内容生成中文标题候选，并严格返回 JSON。" },
        { role: "user", content: prompt },
      ],
    });
    const parsed = content ? parseJsonObject<TitleGenerateResult>(content) : null;
    const result = parsed?.candidates?.length ? parsed : fallback;

    await this.logs.log({
      scene: "title_generate",
      model: this.modelClient.modelName(model),
      inputSummary: `${input.currentTitle ?? ""} / ${input.body.slice(0, 100)}`,
      output: result,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return result;
  }

  private mock(input: TitleGenerateRequest): TitleGenerateResult {
    const body = input.body.trim();
    const keyword = body.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/)?.[0] ?? "这篇内容";
    return {
      candidates: [
        { title: `${keyword}，其实可以讲得更清楚`, reason: "保留内容核心，语气自然" },
        { title: `关于${keyword}，这几个细节更值得写`, reason: "强调信息增量" },
        { title: `${keyword}的实用思路：从场景到方法`, reason: "突出结构和方法感" },
        { title: `别只写${keyword}，把读者关心的点补上`, reason: "增强冲突感" },
        { title: `${keyword}如何写得更有吸引力？`, reason: "适合知识型和经验型内容" },
      ],
    };
  }
}
