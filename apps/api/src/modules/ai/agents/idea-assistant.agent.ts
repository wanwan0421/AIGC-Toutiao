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
    const fallback = this.mock(input.message, input.bodySummary);

    yield* this.modelClient.stream({
      model,
      temperature: 0.75,
      fallback,
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

  private mock(message: string, bodySummary?: string) {
    if (/扩充|补充|增加|展开/.test(message)) {
      return bodySummary
        ? `可以，我会围绕你提出的“${message}”补一段更适合插入正文的内容：\n\n**可插入段落：**\n如果想让这一部分更有画面感，可以把读者带到一个具体场景里：现场的灯光、音乐、人群反应，以及你真正想表达的情绪，都可以写出来。比如先写“走进现场时听到的第一段旋律”，再补充“它为什么让人停下来”，最后落到你的观点：这不只是一次活动，而是一次让人重新感受到生活热度的瞬间。\n\n**建议放置位置：** 放在正文中提到相关场景或案例之后，用来增强代入感。`
        : `当前正文里还没有检测到可参考内容，但可以先给你一段可插入的扩充文本：\n\n**可插入段落：**\n这一部分可以从具体场景写起，让读者先看到画面，再理解观点。比如写现场氛围、人物反应和你的真实感受，最后再收束到这段内容想表达的核心价值。这样会比单纯描述更有感染力。`;
    }

    const base = bodySummary
      ? "我先基于你当前正文来想：这篇内容已经有了雏形，下一步可以强化读者场景、方法步骤和结尾行动。"
      : "可以，我们先从创意角度拆。";
    return `${base}\n\n针对“${message}”，我建议你从三个方向展开：\n1. 先写读者会遇到的真实场景，让开头更容易代入。\n2. 再给一个可复用的方法框架，避免内容变成泛泛而谈。\n3. 最后补一个具体例子或配图建议，让图文更像一篇可以发布的作品。\n\n如果你满意，可以把这段思路插入正文，再继续人工调整。`;
  }
}
