import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreativeConversationSummary } from "@aicp/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { MemoryService } from "./memory.service";

type ArchivedMessage = {
  id: string;
  conversationId: string;
  dedupeKey?: string | null;
  role: "user" | "assistant";
  content: string;
  metadata?: Prisma.JsonValue | null;
  createdAt: Date;
};

type ArchivedConversation = {
  id: string;
  userId: string;
  contentId: string | null;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages?: ArchivedMessage[];
};

type AiArchiveStore = {
  aiConversation: {
    upsert: (args: unknown) => Promise<ArchivedConversation>;
    findFirst: (args: unknown) => Promise<ArchivedConversation | null>;
    findMany: (args: unknown) => Promise<ArchivedConversation[]>;
    update: (args: unknown) => Promise<ArchivedConversation>;
    delete: (args: unknown) => Promise<ArchivedConversation>;
  };
  aiMessage: {
    create: (args: unknown) => Promise<ArchivedMessage>;
    findUnique: (args: unknown) => Promise<ArchivedMessage | null>;
    findMany: (args: unknown) => Promise<ArchivedMessage[]>;
    count: (args: unknown) => Promise<number>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
};

@Injectable()
export class ConversationArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memory: MemoryService
  ) {}

  private get store() {
    return this.prisma as unknown as AiArchiveStore;
  }

  // 确保存在一个活跃的对话，如果提供了 contentId 则尝试找到对应的对话并更新标题，否则创建一个新的对话，并返回该对话的最新状态
  async ensureActiveConversation(input: {
    conversationId: string;
    userId: string;
    contentId?: string | null;
    title?: string;
  }) {
    if (input.contentId) await this.assertOwnedContent(input.contentId, input.userId);
    if (input.contentId) {
      const existing = await this.store.aiConversation.findFirst({
        where: {
          userId: input.userId,
          contentId: input.contentId,
        },
        orderBy: { updatedAt: "desc" },
      });

      if (existing) {
        if (existing.id !== input.conversationId) {
          await this.mergeConversationIfExists({
            sourceConversationId: input.conversationId,
            targetConversationId: existing.id,
            userId: input.userId,
          });
        }

        return this.store.aiConversation.update({
          where: { id: existing.id },
          data: {
            title: input.title ?? existing.title,
          },
        });
      }
    }

    return this.ensureConversation(input);
  }

  async ensureConversation(input: {
    conversationId: string;
    userId: string;
    contentId?: string | null;
    title?: string;
  }) {
    const existing = await this.store.aiConversation.findFirst({ where: { id: input.conversationId } });
    if (existing && existing.userId !== input.userId) throw new NotFoundException("conversation not found");
    if (!existing) {
      return this.store.aiConversation.upsert({
        where: { id: input.conversationId },
        create: { id: input.conversationId, userId: input.userId, contentId: input.contentId ?? undefined, title: input.title },
        update: {},
      });
    }
    return this.store.aiConversation.update({
      where: { id: existing.id },
      data: { contentId: input.contentId ?? undefined, title: input.title },
    });
  }

  async appendMessage(input: {
    id?: string;
    conversationId: string;
    userId: string;
    role: "user" | "assistant";
    content: string;
    metadata?: Record<string, unknown>;
    dedupeKey?: string;
  }) {
    await this.assertOwned(input.conversationId, input.userId);
    if (input.dedupeKey) {
      const existing = await this.store.aiMessage.findUnique({ where: { dedupeKey: input.dedupeKey } });
      if (existing) {
        if (existing.role !== input.role || existing.conversationId !== input.conversationId) {
          throw new Error(`AI message dedupe key collision: ${input.dedupeKey}`);
        }
        await this.memory.appendConversationMessage({
          userId: input.userId,
          conversationId: input.conversationId,
          message: this.toMessageSummary(existing),
        });
        return existing;
      }
    }
    const created = await this.store.aiMessage.create({
      data: {
        id: input.id,
        conversationId: input.conversationId,
        dedupeKey: input.dedupeKey,
        role: input.role,
        content: input.content,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
    await this.memory.appendConversationMessage({
      userId: input.userId,
      conversationId: input.conversationId,
      message: this.toMessageSummary(created),
    });
    return created;
  }

  async allMessages(conversationId: string, userId: string) {
    await this.assertOwned(conversationId, userId);
    return this.store.aiMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  async messageCount(conversationId: string, userId: string) {
    await this.assertOwned(conversationId, userId);
    return this.store.aiMessage.count({ where: { conversationId } });
  }

  async recentMessages(conversationId: string, userId: string, limit = 12): Promise<CreativeConversationSummary["messages"]> {
    const cached = await this.memory.getConversationHistory({ conversationId, userId, limit });
    if (cached.messages) return cached.messages;

    await this.assertOwned(conversationId, userId);
    const messages = await this.store.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const result = messages.reverse().map((message) => this.toMessageSummary(message));
    await this.memory.setConversationHistory({
      conversationId,
      userId,
      generation: cached.generation,
      limit,
      messages: result,
    });
    return result;
  }

  async listByContent(input: { userId: string; contentId: string; limit?: number }) {
    await this.consolidateContentConversations(input.userId, input.contentId);

    const conversations = await this.store.aiConversation.findMany({
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
      take: input.limit ?? 1,
    });

    return conversations.map((conversation) => this.toConversationSummary(conversation));
  }

  async attachToContent(input: { conversationId: string; userId: string; contentId: string }) {
    await this.assertOwnedContent(input.contentId, input.userId);
    const source = await this.store.aiConversation.findFirst({
      where: {
        id: input.conversationId,
        userId: input.userId,
      },
    });

    const target = await this.store.aiConversation.findFirst({
      where: {
        userId: input.userId,
        contentId: input.contentId,
        id: source ? { not: source.id } : undefined,
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!source) {
      if (target) return target;
      throw new NotFoundException("conversation not found");
    }

    if (source.contentId === input.contentId) {
      return source;
    }

    if (target) {
      await this.mergeConversation({
        sourceConversationId: source.id,
        targetConversationId: target.id,
      });
      return target;
    }

    return this.store.aiConversation.update({
      where: { id: source.id },
      data: {
        contentId: input.contentId,
      },
    });
  }

  private async consolidateContentConversations(userId: string, contentId: string) {
    const conversations = await this.store.aiConversation.findMany({
      where: { userId, contentId },
      orderBy: { updatedAt: "desc" },
    });

    const [active, ...duplicates] = conversations;
    if (!active || duplicates.length === 0) return;

    for (const duplicate of duplicates) {
      await this.mergeConversation({
        sourceConversationId: duplicate.id,
        targetConversationId: active.id,
      });
    }
  }

  private async mergeConversationIfExists(input: {
    sourceConversationId: string;
    targetConversationId: string;
    userId: string;
  }) {
    const source = await this.store.aiConversation.findFirst({
      where: {
        id: input.sourceConversationId,
        userId: input.userId,
      },
    });

    if (!source) return;

    await this.mergeConversation({
      sourceConversationId: input.sourceConversationId,
      targetConversationId: input.targetConversationId,
    });
  }

  private async mergeConversation(input: { sourceConversationId: string; targetConversationId: string }) {
    if (input.sourceConversationId === input.targetConversationId) return;

    await Promise.all([
      this.prisma.aiConversationProviderSession.deleteMany({
        where: { conversationId: { in: [input.sourceConversationId, input.targetConversationId] } },
      }),
      this.prisma.aiConversationSummary.deleteMany({
        where: { conversationId: { in: [input.sourceConversationId, input.targetConversationId] } },
      }),
    ]);
    await this.store.aiMessage.updateMany({
      where: { conversationId: input.sourceConversationId },
      data: { conversationId: input.targetConversationId },
    });
    await this.store.aiConversation.delete({
      where: { id: input.sourceConversationId },
    });
    await Promise.all([
      this.memory.invalidateConversation(input.sourceConversationId),
      this.memory.invalidateConversation(input.targetConversationId),
    ]);
  }

  private toConversationSummary(conversation: ArchivedConversation): CreativeConversationSummary {
    return {
      id: conversation.id,
      contentId: conversation.contentId ?? undefined,
      title: conversation.title ?? undefined,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: (conversation.messages ?? []).map((message) => this.toMessageSummary(message)),
    };
  }

  private async assertOwned(conversationId: string, userId: string) {
    const conversation = await this.store.aiConversation.findFirst({ where: { id: conversationId, userId } });
    if (!conversation) throw new NotFoundException("conversation not found");
    return conversation;
  }

  private async assertOwnedContent(contentId: string, userId: string) {
    const count = await this.prisma.content.count({ where: { id: contentId, authorId: userId } });
    if (!count) throw new NotFoundException("content not found");
  }

  private toMessageSummary(message: ArchivedMessage): CreativeConversationSummary["messages"][number] {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
