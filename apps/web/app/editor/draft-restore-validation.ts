import type { AssetSummary, ContentSummary, CreativeConversationSummary } from "@aicp/shared";
import type { EditorDraftCache } from "./use-draft-autosave";

type RestoredSelections = Partial<Pick<EditorDraftCache,
  "assetIds" | "coverAssetId" | "coverMode" | "coverPreview" | "briefMaterialIds" | "chatMaterialIds" |
  "referenceContentIds" | "writingStyleMode" | "writingStyleVersionId" | "writingTopicKey" | "conversationId"
>> & { contentId?: string | null };

type WritingSkillState = {
  activeVersion?: { id: string; profile?: { topics?: Array<{ key: string }> } } | null;
  pauseReason?: string | null;
} | null;

export function shouldRestoreLocalDraft(localSavedAt: string, cloud: { source: string; savedAt: string } | null, cloudUnavailable: boolean) {
  if (cloudUnavailable || !cloud || cloud.source === "empty") return true;
  const localTime = Date.parse(localSavedAt);
  const cloudTime = Date.parse(cloud.savedAt);
  return Number.isFinite(localTime) && Number.isFinite(cloudTime) && localTime >= cloudTime;
}

function uniqueIds(value: unknown) {
  return [...new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [])];
}

function isDocument(asset: AssetSummary) {
  const mime = asset.mimeType.toLowerCase();
  return /\.txt$/i.test(asset.fileName) && mime === "text/plain"
    || /\.(?:md|markdown)$/i.test(asset.fileName) && ["text/plain", "text/markdown", "text/x-markdown", "application/markdown"].includes(mime)
    || /\.pdf$/i.test(asset.fileName) && mime === "application/pdf"
    || /\.docx$/i.test(asset.fileName) && mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export function reconcileRestoredSelections(
  saved: RestoredSelections,
  assets: AssetSummary[],
  contents: ContentSummary[],
  writingSkill: WritingSkillState,
  conversations: CreativeConversationSummary[],
) {
  const byAssetId = new Map(assets.map((asset) => [asset.id, asset]));
  const imageUsable = (asset: AssetSummary | undefined) => Boolean(asset?.mimeType.startsWith("image/") && asset.auditStatus !== "rejected");
  const documentUsable = (asset: AssetSummary | undefined) => Boolean(asset && isDocument(asset) && asset.auditStatus === "approved"
    && asset.source === "uploaded" && typeof asset.metadata?.storageKey === "string");
  const selectMaterials = (ids: string[] = []) => {
    const selected: AssetSummary[] = [];
    const invalid: string[] = [];
    let documentCount = 0;
    for (const id of uniqueIds(ids)) {
      const asset = byAssetId.get(id);
      if (imageUsable(asset) || documentUsable(asset) && documentCount < 3) {
        selected.push(asset!);
        if (documentUsable(asset)) documentCount += 1;
      } else invalid.push(asset?.fileName ?? `素材 ${id}`);
    }
    return { selected, invalid };
  };

  const brief = selectMaterials(saved.briefMaterialIds);
  const chat = selectMaterials(saved.chatMaterialIds);
  const attachmentIds: string[] = [];
  const invalidAttachmentIds: string[] = [];
  for (const id of uniqueIds(saved.assetIds)) {
    const asset = byAssetId.get(id);
    if (imageUsable(asset)) attachmentIds.push(id);
    else invalidAttachmentIds.push(asset?.fileName ?? `图片 ${id}`);
  }
  const requestedCoverId = saved.coverAssetId || assets.find((asset) => asset.url === saved.coverPreview)?.id;
  const cover = saved.coverMode === "none" ? null : requestedCoverId && imageUsable(byAssetId.get(requestedCoverId))
    ? byAssetId.get(requestedCoverId)! : null;
  if (cover && !attachmentIds.includes(cover.id)) attachmentIds.unshift(cover.id);
  const invalidCover = saved.coverMode !== "none" && (requestedCoverId || saved.coverPreview) && !cover
    ? "封面图片已失效" : null;

  const published = new Set(contents.filter((content) => content.status === "published").map((content) => content.id));
  const referenceIds = uniqueIds(saved.referenceContentIds);
  const validReferenceIds = referenceIds.filter((id) => published.has(id)).slice(0, 5);
  const invalidReferenceIds = referenceIds.filter((id) => !validReferenceIds.includes(id));

  const requestedMode = saved.writingStyleMode ?? "off";
  const version = writingSkill?.activeVersion;
  const validStyle = requestedMode === "off" || Boolean(version && !writingSkill?.pauseReason
    && (!saved.writingStyleVersionId || version.id === saved.writingStyleVersionId)
    && (requestedMode !== "topic" || version.profile?.topics?.some((topic) => topic.key === saved.writingTopicKey)));
  const writingStyleMode = validStyle ? requestedMode : "off";
  const invalidWritingStyle = !validStyle ? "保存时的写作风格已失效，请重新选择" : null;

  const requestedConversationId = saved.conversationId;
  const eligibleConversations = conversations.filter((item) => !saved.contentId || !item.contentId || item.contentId === saved.contentId);
  const conversation = requestedConversationId
    ? eligibleConversations.find((item) => item.id === requestedConversationId) ?? eligibleConversations[0]
    : eligibleConversations[0];
  const invalidConversation = requestedConversationId && !conversation ? "聊天记录已失效" : null;

  return {
    brief, chat, attachmentIds, invalidAttachmentIds, cover, invalidCover,
    validReferenceIds, invalidReferenceIds,
    writingStyleMode, invalidWritingStyle,
    conversation: conversation ?? null, invalidConversation,
  };
}
