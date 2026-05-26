import { Injectable } from "@nestjs/common";
import type { CreativeChatRequest } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { IdeaAssistantAgent } from "../agents/idea-assistant.agent";
import { ContextBuilderService } from "../context-builder.service";
import { MemoryService } from "../memory.service";

@Injectable()
export class CreativeChatSkill {
  constructor(
    private readonly contextBuilder: ContextBuilderService,
    private readonly ideaAssistant: IdeaAssistantAgent,
    private readonly memory: MemoryService,
    private readonly logs: AiCallLogService
  ) {}

  async *stream(request: CreativeChatRequest) {
    const startedAt = Date.now();
    const context = await this.contextBuilder.buildCreativeChatContext(request);
    const historyText = this.contextBuilder.formatHistory(context.history);
    const messageId = this.memory.createMessageId();
    let assistantContent = "";

    yield {
      type: "meta" as const,
      data: {
        conversationId: context.conversationId,
        messageId,
      },
    };

    for await (const delta of this.ideaAssistant.stream({
      message: request.message,
      currentTitle: context.currentTitle,
      currentBody: context.currentBody,
      bodySummary: context.bodySummary,
      selectedText: context.selectedText,
      historyText,
    })) {
      assistantContent += delta;
      yield {
        type: "delta" as const,
        data: { text: delta },
      };
    }

    await this.memory.appendShortTermMessages(
      {
        userId: context.userId,
        contentId: context.contentId,
        conversationId: context.conversationId,
      },
      [
        { role: "user", content: request.message },
        { role: "assistant", content: assistantContent },
      ]
    );

    await this.logs.log({
      scene: "creative_chat",
      model: "creative-chat-skill",
      inputSummary: request.message.slice(0, 160),
      output: {
        conversationId: context.conversationId,
        messageId,
        content: assistantContent,
      },
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    yield {
      type: "done" as const,
      data: {
        conversationId: context.conversationId,
        messageId,
      },
    };
  }
}
