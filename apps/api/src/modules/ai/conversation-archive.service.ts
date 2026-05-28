import { Injectable } from "@nestjs/common";
import { AiMessageRole, Prisma } from "@prisma/client";
import type { CreativeConversationSummary } from "@aicp/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class ConversationArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureConversation(input: {
    conversationId: string;
    userId: string;
    contentId?: string | null;
    title?: string;
  }) {
    return this.prisma.aiConversation.upsert({
      where: { id: input.conversationId },
      create: {
        id: input.conversationId,
        userId: input.userId,
        contentId: input.contentId ?? undefined,
        title: input.title,
      },
      update: {
        contentId: input.contentId ?? undefined,
        title: input.title,
      },
    });
  }

  async appendMessage(input: {
    id?: string;
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.aiMessage.create({
      data: {
        id: input.id,
        conversationId: input.conversationId,
        role: input.role === "user" ? AiMessageRole.user : AiMessageRole.assistant,
        content: input.content,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async listByContent(input: { userId: string; contentId: string; limit?: number }) {
    const conversations = await this.prisma.aiConversation.findMany({
      where: {
        userId: input.userId,
        contentId: input.contentId,
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: input.limit ?? 5,
    });

    return conversations.map((conversation): CreativeConversationSummary => ({
      id: conversation.id,
      contentId: conversation.contentId ?? undefined,
      title: conversation.title ?? undefined,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role === AiMessageRole.user ? "user" : "assistant",
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
    }));
  }

  async attachToContent(input: { conversationId: string; userId: string; contentId: string }) {
    return this.prisma.aiConversation.updateMany({
      where: {
        id: input.conversationId,
        userId: input.userId,
      },
      data: {
        contentId: input.contentId,
      },
    });
  }
}
