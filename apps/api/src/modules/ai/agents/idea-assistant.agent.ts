import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ModelClientService } from "../model-client.service";
import { PromptTemplateService } from "../prompt-template.service";
import { AI_PROMPT_NAMES } from "../prompt-names";
import { promptTemperature } from "../prompt-model-options";

@Injectable()
export class IdeaAssistantAgent {
  constructor(
    private readonly modelClient: ModelClientService,
    private readonly prompts: PromptTemplateService
  ) {}

  async *stream(input: {
    message: string;
    currentTitle?: string;
    currentBody?: string;
    bodySummary?: string;
    selectedText?: string;
    historyText?: string;
  }, options: { signal?: AbortSignal } = {}) {
    const rendered = await this.prompts.render(AI_PROMPT_NAMES.creativeChat, input, CREATIVE_CHAT_FALLBACK_PROMPT);
    const { model } = rendered;
    const prompt = rendered.prompt.trim() || this.interpolate(CREATIVE_CHAT_FALLBACK_PROMPT, input);

    if (!this.modelClient.hasRemoteProvider(model)) {
      throw new ServiceUnavailableException("AI model is not configured. Please set ARK_API_KEY and ARK_MODEL_ID/ARK_MODEL.");
    }

    yield* this.modelClient.stream({
      model,
      temperature: promptTemperature(rendered.modelOptions, 0.75),
      messages: [
        {
          role: "system",
          content:
            "你是中文内容创作者的伴随式对话助手，只负责碰撞思路、局部辅助和写作建议。用户问什么就回答什么，不要把局部问题改写成完整草稿生成任务。",
        },
        { role: "user", content: prompt },
        {
          role: "user",
          content: `请只回答这个问题：${input.message}`,
        },
      ],
      signal: options.signal,
    });
  }

  private interpolate(template: string, input: {
    message: string;
    currentTitle?: string;
    currentBody?: string;
    bodySummary?: string;
    selectedText?: string;
    historyText?: string;
  }) {
    const values: Record<string, string | undefined> = {
      message: input.message,
      currentTitle: input.currentTitle,
      currentBody: input.currentBody,
      bodySummary: input.bodySummary,
      selectedText: input.selectedText,
      historyText: input.historyText,
    };
    return template.replace(
      /\{\{\s*(message|currentTitle|currentBody|bodySummary|selectedText|historyText)\s*\}\}/g,
      (_, key: string) => values[key] ?? ""
    );
  }
}

const CREATIVE_CHAT_FALLBACK_PROMPT = `你是中文内容创作者的陪伴式写作助手，只负责碰撞思路、局部辅写和写作建议。

用户当前问题：{{message}}
当前标题：{{currentTitle}}
当前正文：{{currentBody}}
正文摘要：{{bodySummary}}
选中文本：{{selectedText}}
最近对话：{{historyText}}

优先回答用户这一轮问题。不要主动把局部问题改写成完整草稿生成任务。`;
