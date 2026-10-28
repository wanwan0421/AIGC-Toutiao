import { describe, expect, it } from "vitest";
import type { AssetSummary, ContentSummary, CreativeConversationSummary } from "@aicp/shared";
import { reconcileRestoredSelections, shouldRestoreLocalDraft } from "./draft-restore-validation";

const image = (id: string, auditStatus: AssetSummary["auditStatus"] = "approved") => ({
  id, fileName: `${id}.png`, mimeType: "image/png", url: `/files/${id}.png`, auditStatus,
}) as AssetSummary;
const document = (id: string, auditStatus: AssetSummary["auditStatus"] = "approved") => ({
  id, fileName: `${id}.pdf`, mimeType: "application/pdf", url: `/files/${id}.pdf`, auditStatus,
  source: "uploaded", metadata: { storageKey: `user-assets/${id}` },
}) as AssetSummary;

describe("draft selection recovery", () => {
  it("restores a local draft over an empty cloud placeholder and checks real cloud timestamps", () => {
    const savedAt = "2026-10-23T08:00:00.000Z";
    expect(shouldRestoreLocalDraft(savedAt, { source: "empty", savedAt: "2026-10-23T09:00:00.000Z" }, false)).toBe(true);
    expect(shouldRestoreLocalDraft(savedAt, { source: "postgres", savedAt: "2026-10-23T09:00:00.000Z" }, false)).toBe(false);
    expect(shouldRestoreLocalDraft(savedAt, { source: "postgres", savedAt: "2026-10-23T07:00:00.000Z" }, false)).toBe(true);
    expect(shouldRestoreLocalDraft(savedAt, null, true)).toBe(true);
  });

  it("keeps owned audited documents, pending images and the saved conversation", () => {
    const saved = {
      contentId: "draft-1", assetIds: ["cover", "deleted"], coverAssetId: "cover", coverMode: "single" as const,
      briefMaterialIds: ["travel", "photo"], chatMaterialIds: ["travel"], referenceContentIds: ["published"],
      writingStyleMode: "topic" as const, writingStyleVersionId: "version-2", writingTopicKey: "travel",
      conversationId: "conversation-1",
    };
    const contents = [{ id: "published", status: "published" }] as ContentSummary[];
    const conversations = [{ id: "conversation-1", contentId: "draft-1", messages: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" }] as CreativeConversationSummary[];
    const result = reconcileRestoredSelections(saved, [image("cover"), image("photo", "pending"), document("travel")], contents,
      { activeVersion: { id: "version-2", profile: { topics: [{ key: "travel" }] } } }, conversations);

    expect(result.brief.selected.map((asset) => asset.id)).toEqual(["travel", "photo"]);
    expect(result.attachmentIds).toEqual(["cover"]);
    expect(result.invalidAttachmentIds).toEqual(["图片 deleted"]);
    expect(result.cover?.id).toBe("cover");
    expect(result.validReferenceIds).toEqual(["published"]);
    expect(result.writingStyleMode).toBe("topic");
    expect(result.conversation?.id).toBe("conversation-1");
  });

  it("uses the current conversation when a saved conversation id was merged", () => {
    const current = { id: "current", contentId: "draft-1", messages: [], createdAt: "2026-01-01", updatedAt: "2026-01-02" } as CreativeConversationSummary;
    const result = reconcileRestoredSelections({ contentId: "draft-1", conversationId: "merged", coverMode: "none" },
      [], [], null, [current]);
    expect(result.conversation?.id).toBe("current");
    expect(result.invalidConversation).toBeNull();
  });

  it("restores a chat that has not yet been linked to a saved work", () => {
    const chat = { id: "chat-1", messages: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" } as CreativeConversationSummary;
    const result = reconcileRestoredSelections({ contentId: null, conversationId: "chat-1", coverMode: "none" },
      [], [], null, [chat]);
    expect(result.conversation?.id).toBe("chat-1");
  });

  it("drops deleted or rejected assets, changed style versions, missing references and foreign conversations", () => {
    const result = reconcileRestoredSelections({
      contentId: "draft-1", assetIds: ["rejected"], coverAssetId: "rejected", coverMode: "single",
      briefMaterialIds: ["deleted-document", "rejected"], referenceContentIds: ["private"],
      writingStyleMode: "topic", writingStyleVersionId: "version-1", writingTopicKey: "travel",
      conversationId: "conversation-2",
    }, [image("rejected", "rejected")], [{ id: "private", status: "draft" } as ContentSummary],
    { activeVersion: { id: "version-2", profile: { topics: [{ key: "travel" }] } } },
    [{ id: "conversation-2", contentId: "another-draft", messages: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" } as CreativeConversationSummary]);

    expect(result.attachmentIds).toEqual([]);
    expect(result.cover).toBeNull();
    expect(result.invalidCover).toBeTruthy();
    expect(result.brief.invalid).toEqual(["素材 deleted-document", "rejected.png"]);
    expect(result.invalidReferenceIds).toEqual(["private"]);
    expect(result.writingStyleMode).toBe("off");
    expect(result.invalidWritingStyle).toBeTruthy();
    expect(result.conversation).toBeNull();
    expect(result.invalidConversation).toBeTruthy();
  });
});
