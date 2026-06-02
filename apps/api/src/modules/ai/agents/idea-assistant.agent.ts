import { Injectable } from "@nestjs/common";
import { ModelClientService } from "../model-client.service";
import { PromptTemplateService } from "../prompt-template.service";
import { AI_PROMPT_NAMES } from "../prompt-names";

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
  }) {
    const { prompt, model } = await this.prompts.render(AI_PROMPT_NAMES.creativeChat, input);

    yield* this.modelClient.stream({
      model,
      temperature: 0.75,
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
    });
  }
}
