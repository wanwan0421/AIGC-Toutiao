import { Injectable, Logger } from "@nestjs/common";
import { AiJobType, type CreativeChatRequest, type SelectionRewriteRequest, type TitleGenerateRequest } from "@aicp/shared";
import { AppError } from "../../../common/app-error";
import { IdeaAssistantAgent } from "../agents/idea-assistant.agent";
import { SelectionRewriterAgent } from "../agents/selection-rewriter.agent";
import { SkillRouterAgent } from "../agents/skill-router.agent";
import { TitleAgent } from "../agents/title.agent";
import { ContextBuilderService } from "../context-builder.service";
import { ConversationArchiveService } from "../conversation-archive.service";
import { ConversationCompactionService } from "../conversation-compaction.service";
import { ConversationSessionService } from "../conversation-session.service";
import { MemoryService } from "../memory.service";
import type { ModelResponseMetadata } from "../model-client.service";
import type { SkillJobRequest, SkillRouterDecision } from "../skills-runtime/skill-runtime.types";

@Injectable()
export class CreativeAssistantUseCase {
  private readonly logger = new Logger(CreativeAssistantUseCase.name);

  constructor(
    private readonly contextBuilder: ContextBuilderService,
    private readonly ideaAssistant: IdeaAssistantAgent,
    private readonly memory: MemoryService,
    private readonly titleAgent: TitleAgent,
    private readonly selectionRewriter: SelectionRewriterAgent,
    private readonly skillRouter: SkillRouterAgent,
    private readonly conversations: ConversationArchiveService,
    private readonly sessions: ConversationSessionService,
    private readonly compaction: ConversationCompactionService
  ) {}

  generateTitles(request: TitleGenerateRequest, options: { signal?: AbortSignal; aiJobId?: string; contentId?: string; conversationId?: string } = {}) {
    return this.titleAgent.run(request, options);
  }

  rewriteSelection(request: SelectionRewriteRequest, options: { signal?: AbortSignal; aiJobId?: string; contentId?: string; conversationId?: string } = {}) {
    return this.selectionRewriter.run(request, options);
  }

  async *streamChat(request: CreativeChatRequest, options: {
    signal?: AbortSignal;
    aiJobId?: string;
    assistantMessageId?: string;
  } = {}) {
    const context = await this.contextBuilder.buildCreativeChatContext(request);
    const assistantMessageId = options.assistantMessageId ?? this.memory.createMessageId();
    let assistantContent = "";
    const conversation = await this.conversations.ensureActiveConversation({
      conversationId: context.conversationId,
      userId: context.userId,
      contentId: context.persistenceContentId,
      title: request.message.slice(0, 48),
    });
    const conversationId = conversation.id;
    const release = await this.memory.acquireConversationLock(conversationId, options.signal);

    try {
      const userMessage = await this.conversations.appendMessage({
        id: this.memory.createMessageId(),
        conversationId,
        userId: context.userId,
        role: "user",
        content: request.message,
        dedupeKey: options.aiJobId ? `ai-job:${options.aiJobId}:user` : undefined,
        metadata: {
          aiJobId: options.aiJobId,
          currentTitle: context.currentTitle,
          selectedText: context.selectedText,
        },
      });
      const archivedHistory = await this.conversations.recentMessages(conversationId, context.userId);
      const historyText = this.contextBuilder.formatHistory(archivedHistory.filter((message) => message.id !== userMessage.id));

      yield { type: "meta" as const, data: { conversationId, messageId: assistantMessageId } };

      const routerDecision = await this.skillRouter.decide({
        message: request.message,
        currentTitle: context.currentTitle,
        currentBody: context.currentBody,
        selectedText: context.selectedText,
        historyText,
      }, {
        signal: options.signal,
        aiJobId: options.aiJobId,
        contentId: context.persistenceContentId ?? undefined,
        conversationId,
      });

      let archiveAssistantMessage = true;
      let remoteResponse = false;

      if (routerDecision.action === "ask_clarification") {
        assistantContent = routerDecision.message ?? "我还需要更多信息，才能判断应该继续聊天、改写当前内容，还是启动完整 Skill。";
        yield { type: "delta" as const, data: { text: assistantContent } };
      } else if (routerDecision.action === "run_skill" && routerDecision.skillKey) {
        const jobRequest = this.buildSkillJobRequest(routerDecision, { conversationId, request, context, historyText });
        if (!jobRequest) {
          assistantContent = this.missingSkillInputMessage(routerDecision);
          yield { type: "delta" as const, data: { text: assistantContent } };
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
      } else {
        remoteResponse = true;
        const modelMessage = routerDecision.action === "edit_current_content"
          ? this.localEditMessage(request.message, context.selectedText)
          : request.message;
        for await (const delta of this.streamRemoteResponse({
          conversationId,
          userId: context.userId,
          userMessageId: userMessage.id,
          assistantMessageId,
          assistantDedupeKey: options.aiJobId ? `ai-job:${options.aiJobId}:assistant` : `assistant:${assistantMessageId}`,
          aiJobId: options.aiJobId,
          contentId: context.persistenceContentId ?? undefined,
          message: modelMessage,
          rawMessage: request.message,
          currentTitle: context.currentTitle,
          currentBody: context.currentBody,
          selectedText: context.selectedText,
          thinking: routerDecision.action === "edit_current_content" ? "disabled" : undefined,
          signal: options.signal,
        })) {
          assistantContent += delta;
          yield { type: "delta" as const, data: { text: delta } };
        }
        archiveAssistantMessage = false;
      }

      if (archiveAssistantMessage) {
        await this.conversations.appendMessage({
          id: assistantMessageId,
          conversationId,
          userId: context.userId,
          role: "assistant",
          content: assistantContent,
          dedupeKey: options.aiJobId ? `ai-job:${options.aiJobId}:assistant` : `assistant:${assistantMessageId}`,
          metadata: { aiJobId: options.aiJobId, source: "local" },
        });
      }
      if (!remoteResponse) {
        await this.sessions.invalidate(conversationId, archiveAssistantMessage ? "local_assistant_message" : "skill_route");
      }

      yield { type: "done" as const, data: { conversationId, messageId: assistantMessageId } };
    } finally {
      if (options.signal?.aborted) {
        await this.sessions.invalidate(conversationId, "job_cancelled").catch(() => undefined);
      }
      await release();
    }
  }

  private async *streamRemoteResponse(input: {
    conversationId: string;
    userId: string;
    userMessageId: string;
    assistantMessageId: string;
    assistantDedupeKey: string;
    aiJobId?: string;
    contentId?: string;
    message: string;
    rawMessage: string;
    currentTitle: string;
    currentBody: string;
    selectedText: string;
    thinking?: "enabled" | "disabled";
    signal?: AbortSignal;
  }) {
    const settings = await this.ideaAssistant.settings();
    const editorContextHash = this.sessions.editorContextHash({ title: input.currentTitle, body: input.currentBody });
    let previousInvalidRetried = false;

    while (true) {
      let decision = await this.sessions.decide({
        conversationId: input.conversationId,
        model: settings.model,
        promptVersionId: settings.promptVersionId,
      });

      if (decision.mode === "recover" && decision.session?.pendingResponseId) {
        const requestKey = input.aiJobId ?? input.assistantDedupeKey;
        if (decision.session.pendingRequestKey !== requestKey) {
          await this.sessions.resetForRebuild(input.conversationId, "orphaned_pending_response");
          decision = await this.sessions.decide({
            conversationId: input.conversationId,
            model: settings.model,
            promptVersionId: settings.promptVersionId,
          });
        } else {
        const recovered = await this.ideaAssistant.retrieve(decision.session.pendingResponseId, { signal: input.signal }).catch(() => null);
        if (recovered?.metadata.status === "completed" && recovered.text) {
          yield recovered.text;
          await this.sessions.commitResponse({
            conversationId: input.conversationId,
            userId: input.userId,
            assistantMessageId: input.assistantMessageId,
            assistantDedupeKey: input.assistantDedupeKey,
            assistantContent: recovered.text,
            responseId: recovered.metadata.responseId ?? decision.session.pendingResponseId,
            responseExpiresAt: recovered.metadata.expireAt,
            model: settings.model,
            promptVersionId: settings.promptVersionId,
            editorContextHash,
            expectedVersion: decision.session.version,
            rebuilt: !decision.session.responseId,
          });
          return;
        }
        if (recovered && ["queued", "in_progress"].includes(recovered.metadata.status ?? "")) {
          throw new AppError({
            code: "UPSTREAM_RESPONSE_PENDING",
            message: "Ark response is still in progress",
            statusCode: 503,
            retryable: true,
            retryAfterMs: 1_500,
            details: { responseId: decision.session.pendingResponseId },
          });
        }
        await this.sessions.resetForRebuild(input.conversationId, "pending_response_unavailable");
        decision = await this.sessions.decide({
          conversationId: input.conversationId,
          model: settings.model,
          promptVersionId: settings.promptVersionId,
        });
        }
      }

      const usingResponses = settings.apiStyle === "responses";
      const rebuilt = !usingResponses || decision.mode !== "continue";
      const rebuildReason = !usingResponses ? "chat_completions_fallback" : decision.reason;
      if (rebuilt && await this.compaction.shouldCompact(input.conversationId, input.userId)) {
        await this.compaction.compact({
          conversationId: input.conversationId,
          userId: input.userId,
          aiJobId: input.aiJobId,
          signal: input.signal,
        }).catch((error) => this.logger.warn(`Conversation compaction fallback: ${error instanceof Error ? error.message : String(error)}`));
      }

      const includeEditorContext = rebuilt || decision.session?.editorContextHash !== editorContextHash;
      const userContent = JSON.stringify({
        message: input.message,
        ...(includeEditorContext
          ? { editorContext: { title: input.currentTitle, body: input.currentBody, selectedText: input.selectedText } }
          : input.selectedText
            ? { editorContext: { selectedText: input.selectedText } }
            : {}),
      });
      const messages = rebuilt
        ? await this.compaction.rebuildMessages({
            conversationId: input.conversationId,
            userId: input.userId,
            currentUserMessageId: input.userMessageId,
            systemPrompt: settings.systemPrompt,
            currentUserContent: userContent,
          })
        : [{ role: "user" as const, content: userContent }];

      let pendingVersion = decision.session?.version;
      let responseMetadata: ModelResponseMetadata = {};
      let output = "";
      try {
        for await (const event of this.ideaAssistant.stream({
          messages,
          previousResponseId: rebuilt ? undefined : decision.session?.responseId ?? undefined,
          messageSummary: input.rawMessage,
          conversationId: input.conversationId,
          aiJobId: input.aiJobId,
          contentId: input.contentId,
          sessionRebuilt: rebuilt,
          rebuildReason,
        }, { signal: input.signal, thinking: input.thinking })) {
          if (event.type === "created" && event.metadata.responseId && usingResponses) {
            const pending = await this.sessions.markPending({
              conversationId: input.conversationId,
              expectedVersion: pendingVersion,
              responseId: event.metadata.responseId,
              model: settings.model,
              promptVersionId: settings.promptVersionId,
              rebuilt,
              pendingRequestKey: input.aiJobId ?? input.assistantDedupeKey,
            });
            pendingVersion = pending.version;
            responseMetadata = this.mergeResponseMetadata(responseMetadata, event.metadata);
          } else if (event.type === "delta") {
            output += event.text;
            yield event.text;
          } else if (event.type === "completed") {
            responseMetadata = this.mergeResponseMetadata(responseMetadata, event.metadata);
          }
        }

        if (!usingResponses) {
          await this.conversations.appendMessage({
            id: input.assistantMessageId,
            conversationId: input.conversationId,
            userId: input.userId,
            role: "assistant",
            content: output,
            dedupeKey: input.assistantDedupeKey,
            metadata: { aiJobId: input.aiJobId, source: "chat_completions_fallback" },
          });
          await this.sessions.invalidate(input.conversationId, "chat_completions_fallback");
          return;
        }

        if (!responseMetadata.responseId) {
          throw new AppError({
            code: "UPSTREAM_INVALID_RESPONSE",
            message: "Ark Responses stream did not contain a response id",
            statusCode: 502,
            retryable: true,
          });
        }
        if (pendingVersion === decision.session?.version || pendingVersion === undefined) {
          const pending = await this.sessions.markPending({
            conversationId: input.conversationId,
            expectedVersion: pendingVersion,
            responseId: responseMetadata.responseId,
            model: settings.model,
            promptVersionId: settings.promptVersionId,
            rebuilt,
            pendingRequestKey: input.aiJobId ?? input.assistantDedupeKey,
          });
          pendingVersion = pending.version;
        }
        await this.sessions.commitResponse({
          conversationId: input.conversationId,
          userId: input.userId,
          assistantMessageId: input.assistantMessageId,
          assistantDedupeKey: input.assistantDedupeKey,
          assistantContent: output,
          responseId: responseMetadata.responseId,
          responseExpiresAt: responseMetadata.expireAt,
          model: settings.model,
          promptVersionId: settings.promptVersionId,
          editorContextHash,
          expectedVersion: pendingVersion!,
          rebuilt,
        });
        return;
      } catch (error) {
        if (error instanceof AppError && error.code === "UPSTREAM_PREVIOUS_RESPONSE_INVALID" && !rebuilt && !previousInvalidRetried) {
          previousInvalidRetried = true;
          await this.sessions.resetForRebuild(input.conversationId, "previous_response_invalid");
          continue;
        }
        throw error;
      }
    }
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

  private mergeResponseMetadata(current: ModelResponseMetadata, next: ModelResponseMetadata): ModelResponseMetadata {
    return {
      responseId: next.responseId ?? current.responseId,
      previousResponseId: next.previousResponseId ?? current.previousResponseId,
      expireAt: next.expireAt ?? current.expireAt,
      model: next.model ?? current.model,
      status: next.status ?? current.status,
      usage: next.usage ?? current.usage,
    };
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
