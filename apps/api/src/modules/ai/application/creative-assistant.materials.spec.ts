import { describe, expect, it, vi } from "vitest";
import { CreativeAssistantUseCase } from "./creative-assistant.use-case";

describe("CreativeAssistantUseCase material input", () => {
  it("sends the complete selected document in the normal chat model request", async () => {
    const stream = vi.fn(async function* (_input: unknown) { yield { type: "delta", text: "收到" }; });
    const useCase = new CreativeAssistantUseCase(
      {
        buildCreativeChatContext: vi.fn(async () => ({ userId: "author-1", contentId: "new-content", persistenceContentId: null, conversationId: "conversation-1", currentTitle: "", currentBody: "", selectedText: "" })),
        formatHistory: vi.fn(() => ""),
      } as never,
      { settings: vi.fn(async () => ({ model: "test-model", promptVersionId: "v1", systemPrompt: "assistant", apiStyle: "chat_completions" })), stream } as never,
      { createMessageId: vi.fn(() => "assistant-1"), acquireConversationLock: vi.fn(async () => async () => undefined) } as never,
      {} as never, {} as never,
      { decide: vi.fn(async () => ({ action: "chat", confidence: 1 })) } as never,
      { ensureActiveConversation: vi.fn(async () => ({ id: "conversation-1" })), appendMessage: vi.fn(async () => ({ id: "user-message-1" })), recentMessages: vi.fn(async () => []) } as never,
      { editorContextHash: vi.fn(() => "context-hash"), decide: vi.fn(async () => ({ mode: "rebuild", reason: "first" })), invalidate: vi.fn(async () => undefined) } as never,
      { shouldCompact: vi.fn(async () => false), rebuildMessages: vi.fn(async (input: { currentUserContent: string }) => [{ role: "user", content: input.currentUserContent }]) } as never,
    );
    const assertMaterialsCurrent = vi.fn(async () => undefined);
    const events = [];
    for await (const event of useCase.streamChat({
      userId: "author-1", message: "请参考这份材料", materialAssetIds: ["doc-1"],
      materialSnapshot: {
        schemaVersion: 1, attachmentAssetIds: ["image-1"],
        materialDocuments: [{ assetId: "doc-1", fileName: "notes.txt", mimeType: "text/plain", fullText: "甲".repeat(8_100) + "尾部唯一信息", fileHash: "a".repeat(64), auditedHash: "a".repeat(64) }],
        referenceContents: [], materialNotes: "现场记录", currentRequest: "请参考这份材料",
      },
    } as never, { assertMaterialsCurrent })) events.push(event);
    const modelInput = stream.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(modelInput.messages[0].content).toContain("尾部唯一信息");
    expect(modelInput.messages[0].content).not.toContain("image-1");
    expect(assertMaterialsCurrent).toHaveBeenCalledOnce();
    expect(events.some((event) => event.type === "delta")).toBe(true);
  });
});
