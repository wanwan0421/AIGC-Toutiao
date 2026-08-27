import { describe, expect, it, vi } from "vitest";
import { ConversationArchiveService } from "./conversation-archive.service";

describe("ConversationArchiveService cache-aside history", () => {
  it("returns a complete Redis snapshot without querying PostgreSQL", async () => {
    const messages = [{ id: "m1", role: "user" as const, content: "hello", createdAt: "2026-08-21T00:00:00.000Z" }];
    const prisma = {
      aiConversation: { findFirst: vi.fn() },
      aiMessage: { findMany: vi.fn() },
    };
    const memory = {
      getConversationHistory: vi.fn(async () => ({ messages, generation: 3 })),
    };
    const service = new ConversationArchiveService(prisma as never, memory as never);

    await expect(service.recentMessages("conversation-1", "user-1", 12)).resolves.toEqual(messages);
    expect(prisma.aiConversation.findFirst).not.toHaveBeenCalled();
    expect(prisma.aiMessage.findMany).not.toHaveBeenCalled();
  });

  it("loads PostgreSQL on a miss and backfills the same cache generation", async () => {
    const createdAt = new Date("2026-08-21T00:00:00.000Z");
    const prisma = {
      aiConversation: { findFirst: vi.fn(async () => ({ id: "conversation-1", userId: "user-1" })) },
      aiMessage: {
        findMany: vi.fn(async () => [
          { id: "m2", role: "assistant", content: "world", createdAt: new Date(createdAt.getTime() + 1_000) },
          { id: "m1", role: "user", content: "hello", createdAt },
        ]),
      },
    };
    const memory = {
      getConversationHistory: vi.fn(async () => ({ messages: null, generation: 7 })),
      setConversationHistory: vi.fn(async () => undefined),
    };
    const service = new ConversationArchiveService(prisma as never, memory as never);

    const result = await service.recentMessages("conversation-1", "user-1", 12);

    expect(result.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(memory.setConversationHistory).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conversation-1",
      userId: "user-1",
      generation: 7,
      limit: 12,
    }));
  });

  it("updates an existing Redis snapshot after the PostgreSQL write", async () => {
    const created = { id: "m1", role: "user" as const, content: "hello", createdAt: new Date("2026-08-21T00:00:00.000Z") };
    const prisma = {
      aiConversation: { findFirst: vi.fn(async () => ({ id: "conversation-1", userId: "user-1" })) },
      aiMessage: { create: vi.fn(async () => created) },
    };
    const memory = { appendConversationMessage: vi.fn(async () => undefined) };
    const service = new ConversationArchiveService(prisma as never, memory as never);

    await service.appendMessage({ conversationId: "conversation-1", userId: "user-1", role: "user", content: "hello" });

    expect(memory.appendConversationMessage).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      userId: "user-1",
      message: { id: "m1", role: "user", content: "hello", createdAt: created.createdAt.toISOString() },
    });
  });

  it("returns the archived message when an AiJob retry reuses the dedupe key", async () => {
    const existing = {
      id: "m1",
      conversationId: "conversation-1",
      dedupeKey: "ai-job:job-1:user",
      role: "user" as const,
      content: "hello",
      createdAt: new Date("2026-08-21T00:00:00.000Z"),
    };
    const prisma = {
      aiConversation: { findFirst: vi.fn(async () => ({ id: "conversation-1", userId: "user-1" })) },
      aiMessage: {
        findUnique: vi.fn(async () => existing),
        create: vi.fn(),
      },
    };
    const memory = { appendConversationMessage: vi.fn(async () => undefined) };
    const service = new ConversationArchiveService(prisma as never, memory as never);

    const result = await service.appendMessage({
      conversationId: "conversation-1",
      userId: "user-1",
      role: "user",
      content: "hello",
      dedupeKey: "ai-job:job-1:user",
    });

    expect(result).toBe(existing);
    expect(prisma.aiMessage.create).not.toHaveBeenCalled();
  });
});
