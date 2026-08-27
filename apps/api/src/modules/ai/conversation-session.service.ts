import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppError } from "../../common/app-error";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { MemoryService } from "./memory.service";

export type ConversationSessionDecision = {
  mode: "continue" | "rebuild" | "recover";
  reason?: string;
  session: Awaited<ReturnType<ConversationSessionService["get"]>>;
};

@Injectable()
export class ConversationSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memory: MemoryService
  ) {}

  get(conversationId: string) {
    return this.prisma.aiConversationProviderSession.findUnique({ where: { conversationId } });
  }

  async decide(input: {
    conversationId: string;
    model: string;
    promptVersionId?: string;
  }): Promise<ConversationSessionDecision> {
    const session = await this.get(input.conversationId);
    if (!session) return { mode: "rebuild", reason: "missing_session", session };
    if (session.pendingResponseId) return { mode: "recover", reason: "pending_response", session };
    if (session.status !== "active" || !session.responseId) {
      return { mode: "rebuild", reason: session.invalidReason ?? "invalidated", session };
    }
    if (session.model !== input.model) return { mode: "rebuild", reason: "model_changed", session };
    if ((session.promptVersionId ?? undefined) !== input.promptVersionId) {
      return { mode: "rebuild", reason: "prompt_changed", session };
    }
    const expirySkewMs = this.positiveInt(process.env.AI_CHAT_RESPONSE_EXPIRY_SKEW_MS, 60_000);
    if (session.responseExpiresAt && session.responseExpiresAt.getTime() <= Date.now() + expirySkewMs) {
      return { mode: "rebuild", reason: "expired", session };
    }
    if (session.chainTurnCount >= this.positiveInt(process.env.AI_CHAT_SESSION_MAX_TURNS, 24)) {
      return { mode: "rebuild", reason: "max_turns", session };
    }
    return { mode: "continue", session };
  }

  editorContextHash(value: { title?: string; body?: string }) {
    return createHash("sha256")
      .update(JSON.stringify({ title: value.title ?? "", body: value.body ?? "" }))
      .digest("hex");
  }

  async markPending(input: {
    conversationId: string;
    expectedVersion?: number;
    responseId: string;
    model: string;
    promptVersionId?: string;
    rebuilt: boolean;
    pendingRequestKey: string;
  }) {
    const existing = await this.get(input.conversationId);
    if (!existing) {
      return this.prisma.aiConversationProviderSession.create({
        data: {
          conversationId: input.conversationId,
          model: input.model,
          promptVersionId: input.promptVersionId,
          pendingResponseId: input.responseId,
          pendingRequestKey: input.pendingRequestKey,
          status: "pending",
          invalidReason: input.rebuilt ? "rebuilding" : null,
        },
      });
    }
    if (existing.pendingResponseId === input.responseId) return existing;
    const changed = await this.prisma.aiConversationProviderSession.updateMany({
      where: {
        conversationId: input.conversationId,
        version: input.expectedVersion ?? existing.version,
      },
      data: {
        pendingResponseId: input.responseId,
        pendingRequestKey: input.pendingRequestKey,
        ...(input.rebuilt ? { responseId: null, responseExpiresAt: null, chainTurnCount: 0 } : {}),
        status: "pending",
        invalidReason: input.rebuilt ? "rebuilding" : null,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw this.conflict();
    return this.prisma.aiConversationProviderSession.findUniqueOrThrow({ where: { conversationId: input.conversationId } });
  }

  async commitResponse(input: {
    conversationId: string;
    userId: string;
    assistantMessageId: string;
    assistantDedupeKey: string;
    assistantContent: string;
    responseId: string;
    responseExpiresAt?: Date;
    model: string;
    promptVersionId?: string;
    editorContextHash: string;
    expectedVersion: number;
    rebuilt: boolean;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      let message = await tx.aiMessage.findUnique({ where: { dedupeKey: input.assistantDedupeKey } });
      if (message && (message.conversationId !== input.conversationId || message.role !== "assistant")) {
        throw new Error(`AI message dedupe key collision: ${input.assistantDedupeKey}`);
      }
      if (!message) {
        message = await tx.aiMessage.create({
          data: {
            id: input.assistantMessageId,
            conversationId: input.conversationId,
            dedupeKey: input.assistantDedupeKey,
            role: "assistant",
            content: input.assistantContent,
            metadata: {
              provider: "volcengine_ark",
              responseId: input.responseId,
            } as Prisma.InputJsonValue,
          },
        });
      }

      const changed = await tx.aiConversationProviderSession.updateMany({
        where: { conversationId: input.conversationId, version: input.expectedVersion },
        data: {
          model: input.model,
          responseId: input.responseId,
          pendingResponseId: null,
          pendingRequestKey: null,
          responseExpiresAt: input.responseExpiresAt,
          promptVersionId: input.promptVersionId,
          syncedMessageId: message.id,
          editorContextHash: input.editorContextHash,
          chainTurnCount: input.rebuilt ? 1 : { increment: 1 },
          status: "active",
          invalidReason: null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        const current = await tx.aiConversationProviderSession.findUnique({ where: { conversationId: input.conversationId } });
        if (current?.responseId !== input.responseId) throw this.conflict();
      }
      return message;
    });

    await this.memory.appendConversationMessage({
      userId: input.userId,
      conversationId: input.conversationId,
      message: {
        id: result.id,
        role: "assistant",
        content: result.content,
        createdAt: result.createdAt.toISOString(),
      },
    });
    return result;
  }

  async invalidate(conversationId: string, reason: string) {
    await this.prisma.aiConversationProviderSession.updateMany({
      where: { conversationId },
      data: {
        status: "invalidated",
        invalidReason: reason,
        pendingResponseId: null,
        pendingRequestKey: null,
        version: { increment: 1 },
      },
    });
  }

  async resetForRebuild(conversationId: string, reason: string) {
    await this.prisma.aiConversationProviderSession.updateMany({
      where: { conversationId },
      data: {
        responseId: null,
        pendingResponseId: null,
        pendingRequestKey: null,
        responseExpiresAt: null,
        chainTurnCount: 0,
        status: "invalidated",
        invalidReason: reason,
        version: { increment: 1 },
      },
    });
    return this.get(conversationId);
  }

  private conflict() {
    return new AppError({
      code: "CONVERSATION_SESSION_CONFLICT",
      message: "Conversation session changed concurrently",
      statusCode: 409,
      retryable: true,
      retryAfterMs: 1_000,
    });
  }

  private positiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
