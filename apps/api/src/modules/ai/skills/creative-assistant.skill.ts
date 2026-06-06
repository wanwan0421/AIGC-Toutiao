import { Injectable } from "@nestjs/common";
import { AiJobType, type CreativeChatRequest, type SelectionRewriteRequest, type TitleGenerateRequest } from "@aicp/shared";
import { AiCallLogService } from "../ai-call-log.service";
import { IdeaAssistantAgent } from "../agents/idea-assistant.agent";
import { SelectionRewriterAgent } from "../agents/selection-rewriter.agent";
import { SkillRouterAgent } from "../agents/skill-router.agent";
import { TitleAgent } from "../agents/title.agent";
import { ContextBuilderService } from "../context-builder.service";
import { ConversationArchiveService } from "../conversation-archive.service";
import { MemoryService } from "../memory.service";
import { AI_PROMPT_NAMES } from "../prompt-names";
import type { SkillJobRequest, SkillRouterDecision } from "../skills-runtime/skill-runtime.types";

@Injectable()
export class CreativeAssistantSkill {
  constructor(
    private readonly contextBuilder: ContextBuilderService,
    private readonly ideaAssistant: IdeaAssistantAgent,
    private readonly memory: MemoryService,
    private readonly logs: AiCallLogService,
    private readonly titleAgent: TitleAgent,
    private readonly selectionRewriter: SelectionRewriterAgent,
    private readonly skillRouter: SkillRouterAgent,
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

    const routerDecision = await this.skillRouter.decide({
      message: request.message,
      currentTitle: context.currentTitle,
      currentBody: context.currentBody,
      selectedText: context.selectedText,
      historyText,
    });

    if (routerDecision.action === "ask_clarification") {
      assistantContent = routerDecision.message ?? "我还需要更多信息才能继续。";
      yield {
        type: "delta" as const,
        data: { text: assistantContent },
      };
    } else if (routerDecision.action === "run_skill" && routerDecision.skillKey) {
      assistantContent = this.skillAssistantMessage(routerDecision);
      
      const jobRequest = this.buildSkillJobRequest(routerDecision, {
        conversationId,
        request,
        context,
        historyText,
      });
      
      yield {
        type: "skill" as const,
        data: {
          type: "skill_started",
          skillKey: routerDecision.skillKey,
          message: assistantContent,
          data: {
            confidence: routerDecision.confidence,
            requiresContent: routerDecision.skillKey === "content-safety-reviewer" && !context.persistenceContentId,
          },
          jobRequest,
        },
      };
    } else {
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

  private skillAssistantMessage(decision: SkillRouterDecision) {
    if (decision.message) return decision.message;
    if (decision.skillKey === "content-production-line") {
      return "已选择：一键图文生成。我会根据你的对话和当前内容生成完整图文，并写入编辑器。";
    }
    if (decision.skillKey === "content-safety-reviewer") {
      return "已选择：内容安全审核。我会检查当前内容是否存在发布风险。";
    }
    return "我会为你执行对应的创作任务。";
  }

  private buildSkillJobRequest(
    decision: SkillRouterDecision,
    input: {
      conversationId: string;
      request: CreativeChatRequest;
      context: Awaited<ReturnType<ContextBuilderService["buildCreativeChatContext"]>>;
      historyText: string;
    }
  ): SkillJobRequest | undefined {
    if (decision.skillKey === "content-production-line") {
      const skillInput = decision.input ?? {};
      return {
        type: AiJobType.CreativeDirectGenerate,
        contentId: input.context.persistenceContentId ?? undefined,
        payload: {
          ...skillInput,
          source: "conversation",
          conversationId: input.conversationId,
          contentId: input.context.persistenceContentId ?? undefined,
          message: input.request.message,
          theme: typeof skillInput.theme === "string" && skillInput.theme.trim() ? skillInput.theme : input.request.message,
          currentTitle: input.context.currentTitle,
          currentBody: input.context.currentBody,
          historyText: input.historyText,
        },
      };
    }

    if (decision.skillKey === "content-safety-reviewer" && input.context.persistenceContentId) {
      return {
        type: AiJobType.ContentSubmitReview,
        contentId: input.context.persistenceContentId,
        payload: {
          source: "conversation",
          conversationId: input.conversationId,
          message: input.request.message,
        },
      };
    }

    return undefined;
  }
}
