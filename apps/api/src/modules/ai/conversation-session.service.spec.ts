import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationSessionService } from "./conversation-session.service";

const originalMaxTurns = process.env.AI_CHAT_SESSION_MAX_TURNS;

describe("ConversationSessionService", () => {
  afterEach(() => {
    if (originalMaxTurns === undefined) delete process.env.AI_CHAT_SESSION_MAX_TURNS;
    else process.env.AI_CHAT_SESSION_MAX_TURNS = originalMaxTurns;
  });

  it("continues an active compatible Responses session", async () => {
    const session = activeSession();
    const service = createService(session);

    await expect(service.decide({
      conversationId: "conversation-1",
      model: "model-1",
      promptVersionId: "prompt-v2",
    })).resolves.toMatchObject({ mode: "continue", session });
  });

  it("rebuilds when the provider response has expired", async () => {
    const service = createService(activeSession({ responseExpiresAt: new Date(Date.now() - 1_000) }));

    await expect(service.decide({
      conversationId: "conversation-1",
      model: "model-1",
      promptVersionId: "prompt-v2",
    })).resolves.toMatchObject({ mode: "rebuild", reason: "expired" });
  });

  it("rebuilds after a prompt change or configured turn limit", async () => {
    const promptChanged = createService(activeSession());
    await expect(promptChanged.decide({
      conversationId: "conversation-1",
      model: "model-1",
      promptVersionId: "prompt-v3",
    })).resolves.toMatchObject({ mode: "rebuild", reason: "prompt_changed" });

    process.env.AI_CHAT_SESSION_MAX_TURNS = "3";
    const maxTurns = createService(activeSession({ chainTurnCount: 3 }));
    await expect(maxTurns.decide({
      conversationId: "conversation-1",
      model: "model-1",
      promptVersionId: "prompt-v2",
    })).resolves.toMatchObject({ mode: "rebuild", reason: "max_turns" });
  });

  it("recovers a pending response before generating again", async () => {
    const service = createService(activeSession({ status: "pending", pendingResponseId: "resp-pending" }));

    await expect(service.decide({
      conversationId: "conversation-1",
      model: "model-1",
      promptVersionId: "prompt-v2",
    })).resolves.toMatchObject({ mode: "recover", reason: "pending_response" });
  });

  it("uses a stable editor hash and changes it when the article changes", () => {
    const service = createService(null);
    const first = service.editorContextHash({ title: "title", body: "body" });
    expect(service.editorContextHash({ title: "title", body: "body" })).toBe(first);
    expect(service.editorContextHash({ title: "title", body: "changed" })).not.toBe(first);
  });
});

function createService(session: ReturnType<typeof activeSession> | null) {
  return new ConversationSessionService({
    aiConversationProviderSession: { findUnique: vi.fn(async () => session) },
  } as never, {} as never);
}

function activeSession(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "conversation-1",
    provider: "volcengine_ark",
    apiStyle: "responses",
    model: "model-1",
    responseId: "resp-1",
    pendingResponseId: null,
    responseExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    promptVersionId: "prompt-v2",
    syncedMessageId: "message-1",
    editorContextHash: "hash-1",
    chainTurnCount: 1,
    status: "active",
    invalidReason: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
