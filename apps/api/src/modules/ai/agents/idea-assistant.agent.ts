import { Injectable } from "@nestjs/common";
import { ModelClientService } from "../model-client.service";
import { PromptTemplateService } from "../prompt-template.service";

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
    const { prompt, model } = await this.prompts.render(
      "creative_chat",
      input,
      `你是今日头条创作者的右侧创作助手，当前模式是「碰撞思路」，不是「直接生成」。

必须优先回答用户这一次的问题：{{message}}
不要根据“主题、目标人群、风格”重新生成整篇图文，除非用户明确要求你生成完整草稿。
如果用户要求扩充、润色、改写正文中的某个部分，请先依据当前正文判断相关段落；如果正文里没有找到该部分，要明确说明“当前正文未检测到该段落”，再给出一段可插入内容。
回答使用 Markdown，但不要输出推理过程、不要重复回答。

当前标题：{{currentTitle}}
当前正文：{{currentBody}}
正文摘要：{{bodySummary}}
选中文本：{{selectedText}}
最近对话：{{historyText}}
用户问题：{{message}}

请给出具体、可插入、可行动的回答。`
    );

    yield* this.modelClient.stream({
      model,
      temperature: 0.75,
      messages: [
        {
          role: "system",
          content:
            "你是中文内容创作者的右侧对话助手，当前只负责碰撞思路和局部辅助。禁止把请求改写成完整图文生成任务；禁止要求用户补充主题、目标人群、风格，除非用户明确说要生成完整草稿。用户问什么就回答什么。",
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
