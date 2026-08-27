import { BadGatewayException, BadRequestException, HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { SelectionRewriteRequest, SelectionRewriteResult } from "@aicp/shared";
import { ModelClientService } from "../model-client.service";
import { PromptTemplateService } from "../prompt-template.service";
import { selectionPromptName } from "../prompt-names";
import { promptTemperature } from "../prompt-model-options";
import { completeStructured } from "../structured-output";
import { selectionRewriteSchema } from "./structured-agent.schemas";

@Injectable()
export class SelectionRewriterAgent {
  constructor(
    private readonly modelClient: ModelClientService,
    private readonly prompts: PromptTemplateService
  ) {}

  async run(input: SelectionRewriteRequest, options: { signal?: AbortSignal; aiJobId?: string; contentId?: string; conversationId?: string } = {}): Promise<SelectionRewriteResult> {
    const selectedText = input.selectedText?.trim();
    if (!selectedText) {
      throw new BadRequestException("selectedText is required");
    }

    const rendered = await this.prompts.render(
      selectionPromptName(input.action),
      input as unknown as Record<string, unknown>,
      this.fallbackPrompt(input.action)
    );
    const { model } = rendered;
    const prompt = rendered.prompt.trim() || this.interpolate(this.fallbackPrompt(input.action), input);

    if (!this.modelClient.hasRemoteProvider(model)) {
      throw new ServiceUnavailableException("AI model is not configured. Please set ARK_API_KEY and ARK_MODEL_ID/ARK_MODEL.");
    }

    try {
      const result = await completeStructured({
        modelClient: this.modelClient,
        name: "selection_rewrite",
        schema: selectionRewriteSchema,
        model,
        telemetry: {
          scene: selectionPromptName(input.action),
          promptKey: rendered.promptKey,
          promptVersionId: rendered.promptVersionId,
          inputSummary: selectedText.slice(0, 120),
          aiJobId: options.aiJobId,
          contentId: options.contentId,
          conversationId: options.conversationId,
        },
        temperature: promptTemperature(rendered.modelOptions, 0.55),
        thinking: "disabled",
        signal: options.signal,
        messages: [
          {
            role: "system",
            content: "你只改写用户选中的文本，不额外解释，并严格返回 JSON：{\"replacement\":\"替换后的文本\"}。",
          },
          { role: "user", content: prompt },
        ],
      });

      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : "unknown selection rewrite error";
      throw new BadGatewayException(`AI selection rewrite failed: ${message}`);
    }
  }

  private fallbackPrompt(action: SelectionRewriteRequest["action"]) {
    const instruction: Record<SelectionRewriteRequest["action"], string> = {
      polish: "请润色选中文本，让表达更顺、更清晰，但不要改变原意。",
      expand: "请扩写选中文本，补充具体场景、细节或可执行建议，并保持与上下文一致。",
      tone: "请将选中文本改写为目标语气，保持信息准确，不新增未经提供的事实。",
    };

    return `${instruction[action]}

选中文本：{{selectedText}}
上下文：{{surroundingContext}}
目标语气：{{tone}}

只返回 JSON：{"replacement":"替换后的文本"}`;
  }

  private interpolate(template: string, input: SelectionRewriteRequest) {
    const values: Record<string, string | undefined> = {
      selectedText: input.selectedText,
      surroundingContext: input.surroundingContext,
      tone: input.tone,
    };
    return template.replace(/\{\{\s*(selectedText|surroundingContext|tone)\s*\}\}/g, (_, key: string) => values[key] ?? "");
  }

}
