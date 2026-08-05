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
export class CreativeAssistantCapability {
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

  async *streamChat(request: CreativeChatRequest, options: { signal?: AbortSignal } = {}) {
    const startedAt = Date.now();
    const context = await this.contextBuilder.buildCreativeChatContext(request);
    const assistantMessageId = this.memory.createMessageId();
    let assistantContent = "";

    const conversation = await this.conversations.ensureActiveConversation({
      conversationId: context.conversationId,
      userId: context.userId,
      contentId: context.persistenceContentId,
      title: request.message.slice(0, 48),
    }).catch(() => null);
    const conversationId = conversation?.id ?? context.conversationId;
    const archivedHistory = conversation ? await this.conversations.recentMessages(conversationId, context.userId).catch(() => []) : [];
    const historyText = this.contextBuilder.formatHistory(archivedHistory.length ? archivedHistory : context.history);

    await this.conversations.appendMessage({
      id: this.memory.createMessageId(),
      conversationId,
      userId: context.userId,
      role: "user",
      content: request.message,
      metadata: {
        currentTitle: context.currentTitle,
        selectedText: context.selectedText,
      },
    }).catch(() => undefined);

    yield {
      type: "meta" as const,
      data: {
        conversationId,
        messageId: assistantMessageId,
      },
    };

    // 路由智能体根据用户输入、对话历史和当前内容状态判断下一步行动：继续对话、局部改写还是执行完整技能
    const routerDecision = await this.skillRouter.decide({
      message: request.message,
      currentTitle: context.currentTitle,
      currentBody: context.currentBody,
      selectedText: context.selectedText,
      historyText,
    }, options);

    let archiveAssistantMessage = true;

    if (routerDecision.action === "ask_clarification") {
      assistantContent = routerDecision.message ?? "我还需要更多信息，才能判断应该继续聊天、改写当前内容，还是启动完整 Skill。";
      yield {
        type: "delta" as const,
        data: { text: assistantContent },
      };
    } else if (routerDecision.action === "run_skill" && routerDecision.skillKey) {
      const jobRequest = this.buildSkillJobRequest(routerDecision, {
        conversationId,
        request,
        context,
        historyText,
      });

      if (!jobRequest) {
        assistantContent = this.missingSkillInputMessage(routerDecision);
        yield {
          type: "delta" as const,
          data: { text: assistantContent },
        };
      } else {
        assistantContent = this.skillAssistantMessage(routerDecision);
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
        archiveAssistantMessage = false;
      }
    } else if (routerDecision.action === "edit_current_content") {
      for await (const delta of this.ideaAssistant.stream({
        message: this.localEditMessage(request.message, context.selectedText),
        currentTitle: context.currentTitle,
        currentBody: context.currentBody,
        bodySummary: context.bodySummary,
        selectedText: context.selectedText,
        historyText,
      }, options)) {
        assistantContent += delta;
        yield {
          type: "delta" as const,
          data: { text: delta },
        };
      }
    } else {
      for await (const delta of this.ideaAssistant.stream({
        message: request.message,
        currentTitle: context.currentTitle,
        currentBody: context.currentBody,
        bodySummary: context.bodySummary,
        selectedText: context.selectedText,
        historyText,
      }, options)) {
        assistantContent += delta;
        yield {
          type: "delta" as const,
          data: { text: delta },
        };
      }
    }

    await this.memory.appendShortTermMessages(
      {
        userId: context.userId,
        contentId: context.contentId,
        conversationId,
      },
      archiveAssistantMessage
        ? [
            { role: "user", content: request.message },
            { role: "assistant", content: assistantContent },
          ]
        : [{ role: "user", content: request.message }]
    );

    if (archiveAssistantMessage) {
      await this.conversations.appendMessage({
        id: assistantMessageId,
        conversationId,
        userId: context.userId,
        role: "assistant",
        content: assistantContent,
      }).catch(() => undefined);
    }

    await this.logs.log({
      scene: AI_PROMPT_NAMES.creativeChat,
      model: "creative-assistant-capability",
      inputSummary: request.message.slice(0, 160),
      output: {
        conversationId,
        messageId: assistantMessageId,
        content: assistantContent,
      },
      latencyMs: Date.now() - startedAt,
      success: true,
    }).catch(() => undefined);

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
      return "已选择：一键完整图文生成。我会根据你的对话和当前内容生成正文、封面和正文配图。";
    }
    if (decision.skillKey === "content-safety-reviewer") {
      return "已选择：内容安全审核。我会检查当前内容是否存在发布风险。";
    }
    return "我会为你执行对应的创作任务。";
  }

  private localEditMessage(message: string, selectedText?: string) {
    const targetInstruction = selectedText?.trim()
      ? "用户已经选中文本，请只围绕选中文本给出可直接替换的改写版本。"
      : "用户没有选中文本，请先定位最可能需要修改的小节，再给出可应用的局部改写建议。";
    return [
      targetInstruction,
      "不要重新生成完整文章，不要生成标题、标签、封面或配图提示。",
      "输出应包含：建议替换位置、改写后的正文片段、简短说明。",
      `用户请求：${message}`,
    ].join("\n");
  }

  private missingSkillInputMessage(decision: SkillRouterDecision) {
    if (decision.skillKey === "content-safety-reviewer") {
      return "内容安全审核需要先关联当前作品。请先在编辑器中保存或打开要审核的内容后再试。";
    }
    return decision.message ?? "这个技能还缺少必要输入，请补充后再试。";
  }

  // 构建Skill任务请求
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
