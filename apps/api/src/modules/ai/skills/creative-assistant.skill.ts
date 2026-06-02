import { Injectable } from "@nestjs/common";
import type { CreativeChatRequest, SelectionRewriteRequest, TitleGenerateRequest } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { IdeaAssistantAgent } from "../agents/idea-assistant.agent";
import { SelectionRewriterAgent } from "../agents/selection-rewriter.agent";
import { TitleAgent } from "../agents/title.agent";
import { ContextBuilderService } from "../context-builder.service";
import { ConversationArchiveService } from "../conversation-archive.service";
import { MemoryService } from "../memory.service";
import { AI_PROMPT_NAMES } from "../prompt-names";

@Injectable()
export class CreativeAssistantSkill {
  constructor(
    private readonly contextBuilder: ContextBuilderService,
    private readonly ideaAssistant: IdeaAssistantAgent,
    private readonly memory: MemoryService,
    private readonly logs: AiCallLogService,
    private readonly titleAgent: TitleAgent,
    private readonly selectionRewriter: SelectionRewriterAgent,
    private readonly conversations: ConversationArchiveService
  ) {}

  generateTitles(request: TitleGenerateRequest) {
    return this.titleAgent.run(request);
  }

  rewriteSelection(request: SelectionRewriteRequest) {
    return this.selectionRewriter.run(request);
  }

  // 流式创作助手：构建上下文、归档对话，并把模型增量输出转发给前端。
  async *streamChat(request: CreativeChatRequest) {
    const startedAt = Date.now();
    const context = await this.contextBuilder.buildCreativeChatContext(request);
    const assistantMessageId = this.memory.createMessageId();
    let assistantContent = "";

    const conversation = await this.conversations.ensureActiveConversation({
      conversationId: context.conversationId,
      userId: context.userId,
      contentId: context.persistenceContentId,
      title: request.message.slice(0, 48),
    });
    const conversationId = conversation.id;
    const archivedHistory = await this.conversations.recentMessages(conversationId);
    const historyText = this.contextBuilder.formatHistory(archivedHistory.length ? archivedHistory : context.history);

    await this.conversations.appendMessage({
      id: this.memory.createMessageId(),
      conversationId,
      role: "user",
      content: request.message,
      metadata: {
        currentTitle: context.currentTitle,
        selectedText: context.selectedText,
      },
    });

    yield {
      type: "meta" as const,
      data: {
        conversationId,
        messageId: assistantMessageId,
      },
    };

    // 将模型流式增量原样转发给调用方。
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

    // 同步短期记忆，便于下一轮上下文构建。
    await this.memory.appendShortTermMessages(
      {
        userId: context.userId,
        contentId: context.contentId,
        conversationId,
      },
      [
        { role: "user", content: request.message },
        { role: "assistant", content: assistantContent },
      ]
    );

    // 归档 AI 回复，保证对话历史可追溯。
    await this.conversations.appendMessage({
      id: assistantMessageId,
      conversationId,
      role: "assistant",
      content: assistantContent,
    });

    // 记录本次 AI 调用，供后续分析与排障使用。
    await this.logs.log({
      scene: AI_PROMPT_NAMES.creativeChat,
      model: "creative-assistant-skill",
      inputSummary: request.message.slice(0, 160),
      output: {
        conversationId,
        messageId: assistantMessageId,
        content: assistantContent,
      },
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    yield {
      type: "done" as const,
      data: {
        conversationId,
        messageId: assistantMessageId,
      },
    };
  }
}
