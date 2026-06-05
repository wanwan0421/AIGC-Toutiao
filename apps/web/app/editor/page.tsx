"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ContentStatus,
  type AuditResult,
  type AuditRiskItem,
  type AssetSummary,
  type ComplianceReplacement,
  type ComplianceRewriteResult,
  type ContentApprovalResult,
  type ContentSummary,
  type DirectGenerateResult,
  type GeneratedImageAsset,
  type LocationCandidate,
  type OfficialTopicSummary,
  type QualityScoreResult,
} from "@aicp/shared";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  attachCreativeConversation,
  createContent,
  deleteAsset,
  deleteContent,
  generateCreativeTitles,
  getAssets,
  getContentDetail,
  getContents,
  getCreativeConversations,
  getCreativeImageConfigStatus,
  getDraft,
  getOfficialTopics,
  postNearbyLocations,
  publishContent,
  rewriteSelection,
  searchLocations,
  startCreativeDraftJob,
  startCreativeImageJob,
  startQualityScoreJob,
  startSubmitReviewJob,
  streamCreativeChat,
  updateContent,
  uploadAsset,
} from "../../lib/api";
import { useAiJob } from "../../lib/use-ai-job";
import { useDraftAutosave, type EditorDraftCache } from "./use-draft-autosave";
import {
  RichTextEditor,
  RichTextRenderer,
  type RichTextEditorHandle,
  type RichTextInitialContent,
  type RichTextSelection,
  type RichTextValue,
} from "./rich-text-editor";
import {
  ChevronDown,
  CheckCircle2,
  Clock3,
  Copy,
  Eye,
  FileText,
  Hash,
  ImagePlus,
  MapPin,
  MessageCircle,
  Search,
  ShieldCheck,
  Smile,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";

type AiMode = "brainstorm" | "direct";
type PrepTab = "brief" | "assets";
type PublishTimeMode = "now" | "scheduled";
type QuickMenu = "topic" | "emoji" | null;
type UploadIntent = "library" | "insert" | "cover";
type CoverMode = "single" | "none";
type Visibility = "public" | "followers" | "private";
type LocationStatus = "idle" | "locating" | "ready" | "denied" | "unsupported" | "failed" | "searching";
type EditorOperation =
  | "delete"
  | "draft"
  | "cover-image"
  | "inline-image"
  | "title"
  | "rewrite"
  | "audit"
  | "quality"
  | "publish";

type DraftCache = EditorDraftCache;

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  insertable?: boolean;
};

type DraftCard = {
  id: string;
  title: string;
  updatedAt: string;
  body?: string;
};

type ReviewRewrite = ComplianceRewriteResult | null;

type ReviewResultState = {
  content: ContentSummary;
  audit: AuditResult;
} | null;

type SelectionMenuState = {
  top: number;
  left: number;
  text: string;
} | null;

type EditorSnapshotInput = Partial<DraftCache> & {
  assetPreviews?: AssetSummary[];
};

type CloudDraft = Awaited<ReturnType<typeof getDraft>>;
type ContentDetailForDraft = Awaited<ReturnType<typeof getContentDetail>>;

const defaultIdeas = [
  "帮我把当前主题拆成 3 个可发布角度",
  "帮我补充一个更有冲突感的开头",
  "请为正文中的某个片段扩充生活化案例",
  "根据当前正文生成 5 个今日头条标题",
];

const emojiSuggestions = ["😊", "✨", "🔥", "👍", "💡", "📌", "🌿", "🎵"];
const contentStatements = ["无声明", "取材网络", "个人观点，仅供参考", "引用 AI", "健康医疗分享，仅供参考"];
const editableDraftStatuses = new Set<ContentStatus>([ContentStatus.Draft, ContentStatus.Updated, ContentStatus.Rejected]);
const tonePresets = ["专业严谨", "亲和口语", "种草安利", "克制客观", "活泼轻松"];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textToEditorHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

// 将纯文本内容转换为适合编辑器显示的 HTML 格式，同时处理其中的换行和图片等媒体元素
function contentToEditorHtml(text: string, assets: AssetSummary[] = []) {
  const bodyHtml = textToEditorHtml(text);
  const imageHtml = assets
    .filter(isImageAsset)
    .map((asset) => `<figure><img src="${asset.url}" alt="${escapeHtml(asset.fileName)}" /><figcaption>${escapeHtml(asset.fileName)}</figcaption></figure>`)
    .join("");
  return [bodyHtml, imageHtml].filter(Boolean).join("");
}

function markdownToEditorHtml(markdown: string) {
  if (!markdown.trim()) return "";
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul>${listItems.join("")}</ul>`);
    listItems = [];
  };
  const inline = (value: string) =>
    escapeHtml(value)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code>$1</code>");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (/^#{1,3}\s+/.test(trimmed)) {
      flushList();
      html.push(`<h2>${inline(trimmed.replace(/^#{1,3}\s+/, ""))}</h2>`);
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      listItems.push(`<li>${inline(trimmed.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    flushList();
    html.push(`<p>${inline(trimmed)}</p>`);
  }

  flushList();
  return html.join("");
}

function stripDuplicateTitleFromMarkdown(markdown: string, title: string) {
  const titleText = normalizeComparableText(title);
  if (!titleText) return markdown;

  const lines = markdown.split(/\r?\n/);
  while (lines.length && !lines[0]?.trim()) lines.shift();
  if (!lines.length) return markdown;

  const firstLine = lines[0].trim().replace(/^#{1,6}\s+/, "");
  if (normalizeComparableText(firstLine) === titleText) {
    lines.shift();
    while (lines.length && !lines[0]?.trim()) lines.shift();
    return lines.join("\n");
  }

  return markdown;
}

function normalizeComparableText(value: string) {
  return value
    .replace(/^#+\s*/, "")
    .replace(/[《》“”"'`*_#\s:：，。！？!?、-]/g, "")
    .toLowerCase();
}

function draftStorageKey(contentId: string | null) {
  return `aicp:editor-draft:${contentId ?? "new"}`;
}

function formatTime(value?: string) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function isImageAsset(asset: AssetSummary) {
  return asset.mimeType.startsWith("image/");
}

function isTextAsset(asset: AssetSummary) {
  return asset.mimeType.startsWith("text/");
}

function textAssetPreview(asset: AssetSummary) {
  const preview = asset.metadata?.previewText ?? asset.metadata?.preview ?? asset.metadata?.text;
  return typeof preview === "string" ? preview : asset.fileName;
}

function normalizeTopicName(value: string) {
  return value.trim().replace(/^#+/, "").replace(/\s+/g, "");
}

function normalizeTopicList(values: string[]) {
  return Array.from(
    new Set(values.map(normalizeTopicName).filter((item) => item.length > 0)),
  );
}

function compactTopicMatchText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function topicMatchScore(topicTitle: string, source: string) {
  const topic = compactTopicMatchText(normalizeTopicName(topicTitle));
  const text = compactTopicMatchText(source);
  if (!topic || !text) return 0;
  if (text.includes(topic)) return 1000 + topic.length;

  const topicChars = Array.from(new Set(Array.from(topic)));
  const overlap = topicChars.filter((char) => text.includes(char)).length;
  return overlap ? overlap / topicChars.length : 0;
}

const contentStatusLabels: Record<ContentStatus, string> = {
  [ContentStatus.Draft]: "草稿",
  [ContentStatus.PendingReview]: "安全审核通过",
  [ContentStatus.Approved]: "审核通过，可发布",
  [ContentStatus.Rejected]: "安全审核未通过",
  [ContentStatus.Published]: "已发布",
  [ContentStatus.Updated]: "已更新，待发布",
  [ContentStatus.Offline]: "已下线",
};

const visibilityLabels: Record<Visibility, string> = {
  public: "公开",
  followers: "仅粉丝可见",
  private: "仅自己可见",
};

const publishTimeLabels: Record<PublishTimeMode, string> = {
  now: "立即发布",
  scheduled: "定时发布",
};

const coverModeLabels: Record<CoverMode, string> = {
  single: "单图",
  none: "无封面",
};

const qualityDimensionLabels: Record<keyof QualityScoreResult["dimensions"], string> = {
  structure: "结构完整",
  clarity: "表达清晰",
  value: "内容价值",
  attraction: "吸引力",
  compliance: "合规性",
};

function nonEmptyText(value: string | null | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function payloadObject(draft: CloudDraft) {
  return (draft.payload && typeof draft.payload === "object" ? draft.payload : {}) as Record<string, unknown>;
}

function payloadString(payload: Record<string, unknown>, key: string, fallback = "") {
  const value = payload[key];
  return typeof value === "string" ? value : fallback;
}

function payloadBoolean(payload: Record<string, unknown>, key: string, fallback: boolean) {
  const value = payload[key];
  return typeof value === "boolean" ? value : fallback;
}

function payloadStringArray(payload: Record<string, unknown>, key: string, fallback: string[]) {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function payloadJson(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function payloadCoverMode(payload: Record<string, unknown>, fallback: CoverMode): CoverMode {
  const value = payload.coverMode;
  return value === "single" || value === "none" ? value : fallback;
}

function payloadPublishTimeMode(payload: Record<string, unknown>): PublishTimeMode {
  return payload.publishTimeMode === "scheduled" ? "scheduled" : "now";
}

function payloadVisibility(payload: Record<string, unknown>): Visibility {
  const value = payload.visibility;
  return value === "followers" || value === "private" || value === "public" ? value : "public";
}

function riskTypeLabel(type: AuditRiskItem["type"]) {
  const labels: Record<AuditRiskItem["type"], string> = {
    pornography: "涉黄",
    gambling: "涉赌",
    drug: "涉毒",
    sensitive: "敏感",
    vulgar: "低俗",
    privacy: "隐私",
    illegal: "违法",
    fraud: "诈骗",
    minor: "未成年人",
    none: "无风险",
  };
  return labels[type] ?? type;
}

function riskSeverityLabel(severity: AuditRiskItem["severity"]) {
  const labels: Record<AuditRiskItem["severity"], string> = {
    low: "低风险",
    medium: "中风险",
    high: "高风险",
  };
  return labels[severity];
}

function riskSeverityClass(severity: AuditRiskItem["severity"]) {
  if (severity === "high") return "bg-rose-100 text-rose-700";
  if (severity === "medium") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function textFromHtml(html: string) {
  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.innerHTML = html;
    return container.textContent ?? "";
  }
  return html.replace(/<[^>]*>/g, "");
}

function htmlHasMedia(html: string) {
  return /<(img|video|audio|iframe)\b/i.test(html);
}

// 判断是使用富文本 HTML 结构还是降级退为 markdown-to-html 的平文本
function resolveEditorHtml(body: string, html?: string, assets: AssetSummary[] = []) {
  const savedHtml = html?.trim() ?? "";
  if (!savedHtml) return contentToEditorHtml(body, assets);

  // Draft.body 是正文真源；payload.html 只保留富文本结构。空壳 HTML 不能覆盖已有正文。
  if (textFromHtml(savedHtml).trim() || (!body.trim() && htmlHasMedia(savedHtml))) {
    return savedHtml;
  }

  return contentToEditorHtml(body, assets);
}

function snapshotFromCloudDraft(draft: CloudDraft, detail: ContentDetailForDraft): EditorSnapshotInput {
  const payload = payloadObject(draft);
  const body = nonEmptyText(draft.body, detail.body);
  const fallbackCoverMode: CoverMode = detail.coverUrl ? "single" : "none";

  return {
    contentId: draft.contentId,
    title: draft.title ?? detail.title,
    body,
    html: resolveEditorHtml(body, payloadString(payload, "html", detail.bodyHtml ?? ""), detail.assets),
    json: payloadJson(payload, "json") ?? detail.bodyJson ?? null,
    assetPreviews: detail.assets,
    selectedTopics: payloadStringArray(payload, "tags", detail.tags),
    coverPreview: payloadString(payload, "coverPreview", detail.coverUrl ?? ""),
    coverMode: payloadCoverMode(payload, fallbackCoverMode),
    assetIds: payloadStringArray(payload, "assetIds", detail.assets.map((item) => item.id)),
    briefTheme: payloadString(payload, "briefTheme"),
    audience: payloadString(payload, "audience"),
    style: payloadString(payload, "style"),
    viewpoint: payloadString(payload, "viewpoint"),
    publishTimeMode: payloadPublishTimeMode(payload),
    scheduledAt: payloadString(payload, "scheduledAt"),
    selectedLocation: payloadString(payload, "selectedLocation"),
    visibility: payloadVisibility(payload),
    originalStatement: payloadBoolean(payload, "originalStatement", false),
    contentStatement: payloadString(payload, "contentStatement", "无声明"),
  };
}

export default function EditorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { runJob } = useAiJob();
  const editingContentId = searchParams.get("contentId");
  const editorRef = useRef<RichTextEditorHandle | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const streamLockRef = useRef(false);
  const editorReadyRef = useRef(false);
  const skipNextEditorInitRef = useRef<string | null>(null);
  const draggedAssetRef = useRef<AssetSummary | null>(null);
  const uploadIntentRef = useRef<UploadIntent>("library");
  const snapshotRef = useRef<() => DraftCache>(() => snapshot());
  const bodyRef = useRef("");
  const contentIdRef = useRef<string | null>(editingContentId);
  const conversationIdRef = useRef<string | undefined>();
  const publishRedirectTimerRef = useRef<number | null>(null);

  const [contentId, setContentId] = useState<string | null>(editingContentId);
  const [editingStatus, setEditingStatus] = useState<ContentStatus | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [briefTheme, setBriefTheme] = useState("");
  const [audience, setAudience] = useState("");
  const [style, setStyle] = useState("");
  const [viewpoint, setViewpoint] = useState("");
  const [prepTab, setPrepTab] = useState<PrepTab>("brief");
  const [aiMode, setAiMode] = useState<AiMode>("brainstorm");
  const [chatInput, setChatInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [titleCandidates, setTitleCandidates] = useState<
    Array<{ title: string; reason: string }>
  >([]);
  const [showTitleCandidates, setShowTitleCandidates] = useState(false);
  const [statusMessage, setStatusMessage] = useState("编辑器已准备好");
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [activeOperation, setActiveOperation] = useState<EditorOperation | null>(null);
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [hotTopics, setHotTopics] = useState<OfficialTopicSummary[]>([]);
  const [quickMenu, setQuickMenu] = useState<QuickMenu>(null);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState>(null);
  const [toneMenuOpen, setToneMenuOpen] = useState(false);
  const [customTone, setCustomTone] = useState("");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [customTopicInput, setCustomTopicInput] = useState("");
  const [coverPreview, setCoverPreview] = useState("");
  const [coverMode, setCoverMode] = useState<CoverMode>("single");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [publishTimeMode, setPublishTimeMode] =
    useState<PublishTimeMode>("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [locationCandidates, setLocationCandidates] = useState<LocationCandidate[]>([]);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [contentStatementOpen, setContentStatementOpen] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [publishTimeOpen, setPublishTimeOpen] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [originalStatement, setOriginalStatement] = useState(false);
  const [contentStatement, setContentStatement] = useState("无声明");
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [assetPanel, setAssetPanel] = useState<null | "image" | "text">(null);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [lastContentSummary, setLastContentSummary] = useState<ContentSummary | null>(null);
  const [reviewResult, setReviewResult] = useState<ReviewResultState>(null);
  const [reviewRewrite, setReviewRewrite] = useState<ReviewRewrite>(null);
  const [qualityResult, setQualityResult] = useState<QualityScoreResult | null>(null);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [imageConfig, setImageConfig] = useState<{
    configured: boolean;
    missing: string[];
  } | null>(null);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const isBusy = activeOperation !== null;
  const isOperation = (operation: EditorOperation) => activeOperation === operation;

  const imageAssets = useMemo(() => assets.filter(isImageAsset), [assets]);
  const textAssets = useMemo(() => assets.filter(isTextAsset), [assets]);
  const wordCount = useMemo(() => body.replace(/\s/g, "").length, [body]);
  const visibleReviewRiskItems = useMemo(
    () => (reviewResult?.audit.riskItems ?? []).filter((item) => item.severity !== "low"),
    [reviewResult],
  );
  const reviewReplacements = useMemo(() => reviewRewrite?.replacements ?? [], [reviewRewrite]);
  const reviewReplacementByRiskItem = useMemo(
    () => new Map(reviewReplacements.map((replacement) => [replacement.riskItemId, replacement])),
    [reviewReplacements],
  );
  const selectedTopicNameSet = useMemo(
    () => new Set(normalizeTopicList(selectedTopics)),
    [selectedTopics],
  );
  const recommendedTopics = useMemo(() => {
    const source = [title, body, briefTheme, viewpoint].join("\n");
    const hasSource = Boolean(compactTopicMatchText(source));
    const candidates = hotTopics.filter(
      (topic) => !selectedTopicNameSet.has(normalizeTopicName(topic.title)),
    );

    if (!hasSource) return candidates.slice(0, 6);

    return candidates
      .map((topic) => ({
        topic,
        score: topicMatchScore(topic.title, source),
      }))
      .filter((item) => item.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.topic.heatScore - left.topic.heatScore ||
          right.topic.contentCount - left.topic.contentCount,
      )
      .map((item) => item.topic)
      .slice(0, 6);
  }, [body, briefTheme, hotTopics, selectedTopicNameSet, title, viewpoint]);
  const qualityReadyStatuses = new Set<ContentStatus>([
    ContentStatus.Approved,
    ContentStatus.Updated,
    ContentStatus.Published,
    ContentStatus.PendingReview,
  ]);
  const canRunQualityReview = Boolean(editingStatus && qualityReadyStatuses.has(editingStatus));
  const canPublishContent =
    editingStatus === ContentStatus.Approved ||
    editingStatus === ContentStatus.Updated ||
    editingStatus === ContentStatus.PendingReview;
  const [editorHtmlContent, setEditorHtmlContent] = useState(""); // 当 editorRef 还没挂载时，把 HTML 存在状态里
  const [editorJsonContent, setEditorJsonContent] = useState<Record<string, unknown> | null>(null);
  const [editorResetKey, setEditorResetKey] = useState(0);
  snapshotRef.current = snapshot;

  const {
    isOnline,
    localSaveError,
    scheduleLocalDraftSave,
    scheduleCloudAutosave,
    readLocalDraft,
    removeLocalDraft,
    autoSaveDraft,
  } = useDraftAutosave({
    editorReadyRef,
    snapshotRef,
    draftStorageKey,
    ensureContentForDraft,
    isMeaningful: (data) => Boolean(data.title.trim() || data.body.trim() || editorRef.current?.getText().trim()),
    onStatus: setStatusMessage,
    onCloudSaved: loadDraftCards,
  });

  useEffect(() => {
    bodyRef.current = body;
  }, [body]);

  useEffect(() => {
    contentIdRef.current = contentId;
  }, [contentId]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    setContentId(editingContentId);
  }, [editingContentId]);

  useEffect(() => {
    if (editingContentId && skipNextEditorInitRef.current === editingContentId) {
      skipNextEditorInitRef.current = null;
      void loadDraftCards();
      void loadAssets();
      return;
    }

    void initializeEditor();
    void loadDraftCards();
    void loadAssets();
    void loadTopics();
    void loadImageConfig();
  }, [editingContentId]);

  useEffect(() => {
    if (localSaveError) setStatusMessage(localSaveError);
  }, [localSaveError]);

  useEffect(() => {
    void refreshNearbyLocations(false);
  }, []);

  useEffect(() => {
    return () => {
      if (publishRedirectTimerRef.current) {
        window.clearTimeout(publishRedirectTimerRef.current);
      }
    };
  }, []);

  // 内容变更触发：先防抖写本地，再防抖尝试云端；hook 内部仍保留 30 秒轮询兜底。
  useEffect(() => {
    scheduleLocalDraftSave();
    scheduleCloudAutosave();
  }, [
    assetIds,
    audience,
    body,
    briefTheme,
    contentStatement,
    coverMode,
    coverPreview,
    editorHtmlContent,
    editorJsonContent,
    originalStatement,
    publishTimeMode,
    scheduledAt,
    selectedLocation,
    selectedTopics,
    scheduleCloudAutosave,
    scheduleLocalDraftSave,
    style,
    title,
    viewpoint,
    visibility,
  ]);

  function editorHtml() {
    return editorRef.current?.getHTML() ?? editorHtmlContent;
  }

  function editorText() {
    const domText = editorRef.current?.getText().trim();
    return domText || bodyRef.current.trim();
  }

  function editorJson() {
    return (editorRef.current?.getJSON() as Record<string, unknown> | undefined) ?? editorJsonContent;
  }

  function scheduledDate() {
    return scheduledAt ? scheduledAt.slice(0, 10) : "";
  }

  function scheduledTime() {
    return scheduledAt ? scheduledAt.slice(11, 16) : "";
  }

  function updateScheduledAtPart(part: "date" | "time", value: string) {
    if (part === "date") {
      setScheduledAt(value ? `${value}T${scheduledTime() || "09:00"}` : "");
      return;
    }

    const date = scheduledDate();
    setScheduledAt(date && value ? `${date}T${value}` : scheduledAt);
  }

  function snapshot(): DraftCache {
    const currentBody = editorText();
    const currentHtml = editorHtml();
    return {
      savedAt: new Date().toISOString(),
      contentId: contentIdRef.current,
      title,
      body: currentBody,
      html: currentHtml.trim() ? currentHtml : textToEditorHtml(currentBody),
      json: editorJson(),
      briefTheme,
      audience,
      style,
      viewpoint,
      selectedTopics,
      coverPreview,
      coverMode,
      assetIds,
      publishTimeMode,
      scheduledAt,
      selectedLocation,
      visibility,
      originalStatement,
      contentStatement,
    };
  }

  // 草稿恢复的总出口，负责将数据赋回 React 各个散装的状态里
  function applySnapshot(data: EditorSnapshotInput) {
    const nextBody = data.body ?? "";
    const nextHtml = resolveEditorHtml(
      nextBody,
      data.html,
      data.assetPreviews ?? [],
    );
    setContentId(data.contentId ?? null);
    setTitle(data.title ?? "");
    setBody(nextBody);
    setBriefTheme(data.briefTheme ?? "");
    setAudience(data.audience ?? "");
    setStyle(data.style ?? "");
    setViewpoint(data.viewpoint ?? "");
    setSelectedTopics(normalizeTopicList(data.selectedTopics ?? []));
    setCoverPreview(data.coverPreview ?? "");
    setCoverMode(data.coverMode ?? "single");
    setAssetIds(data.assetIds ?? []);
    setPublishTimeMode(data.publishTimeMode ?? "now");
    setScheduledAt(data.scheduledAt ?? "");
    setSelectedLocation(data.selectedLocation ?? "");
    setVisibility(data.visibility ?? "public");
    setOriginalStatement(data.originalStatement ?? false);
    setContentStatement(data.contentStatement ?? "无声明");
    writeEditorContent({ html: nextHtml, json: data.json ?? null, text: nextBody });
  }

  function writeEditorContent(content: RichTextInitialContent) {
    const html = content.html ?? "";
    const json = (content.json && typeof content.json === "object" ? content.json : null) as Record<string, unknown> | null;
    const nextText = content.text ?? textFromHtml(html);
    setEditorHtmlContent(html);
    setEditorJsonContent(json);
    setEditorResetKey((value) => value + 1);
    editorRef.current?.setContent(content);
    bodyRef.current = nextText;
    setBody(nextText);
  }

  function writeEditorMarkup(html: string, nextBody?: string) {
    writeEditorContent({ html, json: null, text: nextBody ?? textFromHtml(html) });
  }

  async function openDraftCard(draftId: string) {
    editorReadyRef.current = false;
    setIsLoadingInitial(true);
    router.push(`/editor?contentId=${draftId}`, { scroll: false });
    try {
      const detail = await getContentDetail(draftId);
      setEditingStatus(detail.status);
      setLastContentSummary(detail);
      setContentId(detail.id);
      setTitle(detail.title);
      setSelectedTopics(normalizeTopicList(detail.tags));
      setAssetIds(detail.assets.map((item) => item.id));
      setCoverPreview(detail.coverUrl ?? "");
      setCoverMode(detail.coverUrl ? "single" : "none");
      writeEditorContent({
        html: detail.bodyHtml || contentToEditorHtml(detail.body, detail.assets),
        json: detail.bodyJson ?? null,
        text: detail.body,
      });

      const [draft, conversations] = await Promise.all([
        getDraft(detail.id).catch(() => null),
        getCreativeConversations(detail.id).catch(() => []),
      ]);

      if (draft) {
        applySnapshot(snapshotFromCloudDraft(draft, detail));
      }

      const latestConversation = conversations[0];
      if (latestConversation) {
        setConversationId(latestConversation.id);
        setChatMessages(
          latestConversation.messages.map((item) => ({
            id: item.id ?? `${item.role}-${item.createdAt}`,
            role: item.role,
            content: item.content,
            insertable: item.role === "assistant",
          })),
        );
      } else {
        setConversationId(undefined);
        setChatMessages([]);
      }

      await loadAssets();
      setStatusMessage("已打开草稿");
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `打开草稿失败：${error.message}`
          : "打开草稿失败",
      );
    } finally {
      editorReadyRef.current = true;
      setIsLoadingInitial(false);
    }
  }

  // 首次进入空白编辑页
  async function initializeEditor() {
    editorReadyRef.current = false;
    setIsLoadingInitial(true);
    try {
      if (editingContentId) {
        // 先从后端数据库里面获取数据，避免本地草稿数据过旧导致用户丢失修改内容
        const detail = await getContentDetail(editingContentId);
        setEditingStatus(detail.status);
        setLastContentSummary(detail);
        setTitle(detail.title);
        setSelectedTopics(normalizeTopicList(detail.tags));
        setAssetIds(detail.assets.map((item) => item.id));
        setCoverPreview(detail.coverUrl ?? "");
        setCoverMode(detail.coverUrl ? "single" : "none");
        writeEditorContent({
          html: detail.bodyHtml || contentToEditorHtml(detail.body, detail.assets),
          json: detail.bodyJson ?? null,
          text: detail.body,
        });

        // 再获取草稿数据
        const [draft, conversations] = await Promise.all([
          getDraft(detail.id).catch(() => null),
          getCreativeConversations(detail.id).catch(() => []),
        ]);

        // 如果草稿存在，比较草稿和服务器内容的时间戳，优先恢复较新的内容，避免用户在编辑过程中丢失修改内容
        if (draft) {
          const cloudTime = new Date(draft.savedAt).getTime();
          const local = readLocalDraft(editingContentId);
          const localTime = local ? new Date(local.savedAt).getTime() : 0;
          if (local && localTime >= cloudTime) {
            applySnapshot(local);
            setStatusMessage("已恢复本地离线草稿");
          } else {
            applySnapshot(snapshotFromCloudDraft(draft, detail));
            setStatusMessage("已恢复云端草稿");
          }
        }
        const latestConversation = conversations[0];
        if (latestConversation) {
          setConversationId(latestConversation.id);
          setChatMessages(
            latestConversation.messages.map((item) => ({
              id: item.id ?? `${item.role}-${item.createdAt}`,
              role: item.role,
              content: item.content,
              insertable: item.role === "assistant",
            })),
          );
        }
        await loadAssets();
      } else {
        resetEditorForNewContent();
        // 尝试读取无ID的本地草稿，恢复用户上次进入编辑页时的编辑状态，避免用户在编辑过程中丢失修改内容
        const local = readLocalDraft(null);

        // 如果存在缓存，映射到编辑器状态，恢复编辑内容和选项设置，并提示用户已恢复未发布的草稿
        if (local) {
          applySnapshot(local);
          setStatusMessage("已恢复本地未发布草稿");
        }
      }
    } finally {
      editorReadyRef.current = true;
      setIsLoadingInitial(false);
    }
  }

  // 打开新内容编辑页时重置所有状态，确保不会有旧内容残留，避免用户误操作导致内容混乱
  function resetEditorForNewContent() {
    setEditingStatus(null);
    setTitle("");
    setBody("");
    setSelectedTopics([]);
    setAssetIds([]);
    setCoverPreview("");
    setCoverMode("single");
    setConversationId(undefined);
    setChatMessages([]);
    setShowPreview(false);
    setPreviewHtml("");
    setLastContentSummary(null);
    setReviewResult(null);
    setReviewRewrite(null);
    setQualityResult(null);
    writeEditorContent({ html: "", json: null, text: "" });
  }

  async function loadDraftCards() {
    const items = await getContents().catch(() => []);
    const draftItems = items
      .filter((item) => editableDraftStatuses.has(item.status))
      .slice(0, 8);
    const cards = await Promise.all(
      draftItems.map(async (item) => {
        const draft = await getDraft(item.id).catch(() => null);
        return {
          id: item.id,
          title: draft?.title || item.title || "未命名草稿",
          updatedAt: draft?.savedAt || item.updatedAt,
          body: nonEmptyText(draft?.body, item.excerpt),
        };
      }),
    );
    setDrafts(cards);
  }

  async function deleteDraftCard(draft: DraftCard) {
    const ok = window.confirm(
      `确定删除「${draft.title || "未命名草稿"}」吗？删除后不可恢复。`,
    );
    if (!ok) return;
    if (isBusy) return;
    setActiveOperation("delete");
    try {
      await deleteContent(draft.id);
      removeLocalDraft(draft.id);
      setDrafts((items) => items.filter((item) => item.id !== draft.id));
      if (contentId === draft.id) {
        router.push("/editor", { scroll: false });
        resetEditorForNewContent();
      }
      setStatusMessage("作品已删除");
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `删除作品失败：${error.message}`
          : "删除作品失败",
      );
    } finally {
      setActiveOperation(null);
    }
  }

  async function loadTopics() {
    const topics = await getOfficialTopics(8).catch(() => []);
    setHotTopics(topics);
  }

  async function loadAssets() {
    const items = await getAssets().catch(() => []);
    setAssets(items);
  }

  async function loadImageConfig() {
    const status = await getCreativeImageConfigStatus().catch(() => null);
    if (status) {
      setImageConfig({
        configured: status.configured,
        missing: status.missing,
      });
    }
  }

  async function refreshNearbyLocations(manual: boolean) {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("unsupported");
      setLocationCandidates([]);
      if (manual) setStatusMessage("当前浏览器不支持定位，请使用手动搜索");
      return;
    }

    setLocationStatus("locating");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const response = await postNearbyLocations({ latitude, longitude });
          setLocationCandidates(response.candidates);
          setLocationStatus("ready");
          if (manual) setStatusMessage("已更新附近地点候选");
        } catch (error) {
          setLocationStatus("failed");
          setLocationCandidates([]);
        }
      },
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED;
        setLocationStatus(denied ? "denied" : "failed");
        setLocationCandidates([]);
        if (manual) {
          setStatusMessage(denied ? "定位权限未开启，请使用手动搜索" : "定位失败，请使用手动搜索");
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
  }

  async function handleSearchLocation(keyword: string) {
    const query = keyword.trim();
    if (!query) return;

    setIsSearchingLocation(true);
    setLocationStatus("searching");

    try {
      const response = await searchLocations(query);
      setLocationCandidates(response.candidates);
      setLocationStatus("ready");
      setStatusMessage(response.candidates.length ? "已获取地点搜索结果" : "没有找到匹配地点");
    } catch (error) {
      setLocationStatus("failed");
    } finally {
      setIsSearchingLocation(false);
    }
  }

  // 内容持久化的总出口，负责把编辑器当前状态的内容保存到云端，并返回最新的内容记录
  async function persistContent() {
    const nextBody = editorText();
    const payload = {
      title: title.trim() || "未命名草稿",
      body: nextBody,
      bodyHtml: editorHtml(),
      bodyJson: editorJson(),
      tags: selectedTopics,
      assetIds,
    };
    if (contentId) {
      const updated = await updateContent(contentId, payload);
      setEditingStatus(updated.status);
      setLastContentSummary(updated);
      return updated;
    }
    const created = await createContent(payload);
    setContentId(created.id);
    setEditingStatus(created.status);
    setLastContentSummary(created);
    if (conversationId) {
      await attachCreativeConversation(conversationId, created.id).catch(
        () => undefined,
      );
    }
    return created;
  }

  // 确保草稿在云端有对应的内容记录，返回 contentId
  async function ensureContentForDraft(data: DraftCache) {
    if (data.contentId) return data.contentId;

    // 如果没有 contentId，说明是新草稿，先创建一个内容记录再进行后续的自动保存，避免后续自动保存时频繁创建内容记录
    const created = await createContent({
      title: data.title.trim() || "未命名草稿",
      body: data.body,
      bodyHtml: data.html,
      bodyJson: data.json,
      tags: data.selectedTopics,
      assetIds: data.assetIds,
    });
    setContentId(created.id);
    contentIdRef.current = created.id;
    setEditingStatus(created.status);

    // 静默修改URL，避免页面跳转导致编辑中断，同时也让用户可以通过 URL 直接访问这个草稿
    skipNextEditorInitRef.current = created.id;
    window.history.replaceState(null, "", `/editor?contentId=${created.id}`);

    // 如果之前已经有 conversationId，说明用户在编辑过程中进行了聊天交互，此时需要把这个 conversation 关联到新创建的内容上
    if (conversationIdRef.current) {
      await attachCreativeConversation(
        conversationIdRef.current,
        created.id,
      ).catch(() => undefined);
    }
    return created.id;
  }

  // 在编辑过程中，用户可能会频繁地进行文本输入、格式调整、插入素材等操作。
  // 现在交给 useDraftAutosave 做 800ms 本地防抖、3s 云端防抖和 30s 轮询兜底，避免过多网络请求。
  function syncBodyFromEditor(message?: string) {
    const value = editorRef.current?.getValue();
    const html = value?.html ?? editorHtml();
    const text = value?.text ?? editorText();
    const json = (value?.json as Record<string, unknown> | undefined) ?? editorJsonContent;
    setEditorHtmlContent(html);
    setEditorJsonContent(json);
    bodyRef.current = text;
    setBody(text);
    scheduleLocalDraftSave();
    scheduleCloudAutosave();
    setStatusMessage(
      message ??
        (navigator.onLine
          ? "已保存到本地，等待自动同步"
          : "当前处于离线状态，内容会先保存到本地"),
    );
  }

  function syncRichTextValue(value: RichTextValue, message?: string) {
    setEditorHtmlContent(value.html);
    setEditorJsonContent(value.json as Record<string, unknown>);
    bodyRef.current = value.text;
    setBody(value.text);
    scheduleLocalDraftSave();
    scheduleCloudAutosave();
    if (message) setStatusMessage(message);
  }

  function clearSelectionState() {
    setSelectionMenu(null);
    setToneMenuOpen(false);
  }

  function insertHtml(html: string, message: string) {
    if (!editorRef.current) {
      writeEditorMarkup(`${editorHtml()}${html}`);
      setStatusMessage(message);
      return;
    }
    editorRef.current.insertHTML(html);
    syncBodyFromEditor(message);
    clearSelectionState();
  }

  function insertText(text: string, message: string) {
    if (!editorRef.current) {
      writeEditorMarkup(`${editorHtml()}${textToEditorHtml(text)}`);
      setStatusMessage(message);
      return;
    }
    editorRef.current.insertText(text);
    syncBodyFromEditor(message);
    clearSelectionState();
  }

  function openImageUpload(intent: UploadIntent) {
    uploadIntentRef.current = intent;
    imageInputRef.current?.click();
  }

  function openTextUpload() {
    uploadIntentRef.current = "library";
    textInputRef.current?.click();
  }

  // AI 生成初稿，支持从创作简报或直接输入要求两种方式，生成后填充正文和图片素材到编辑区
  async function createAiDraft(source: "brief" | "direct") {
    const theme =
      source === "direct" && chatInput.trim()
        ? chatInput.trim()
        : briefTheme.trim();
    if (!theme) {
      setStatusMessage("请先填写主题，或在右侧输入直接生成要求");
      return;
    }
    if (isBusy) return;

    setActiveOperation("draft");
    setStatusMessage("AI 正在生成结构化图文...");
    try {
      const generatedAssetIds: string[] = [];
      const draftJob = await runJob(
        () =>
          startCreativeDraftJob({
            contentId: contentId ?? undefined,
            theme,
            audience,
            style,
            viewpoint,
          }),
        {
          onProgress: (data) => {
            if (typeof data.message === "string") setStatusMessage(data.message);
          },
          onPartial: (data) => {
            if (data.kind === "draft") {
              const result = data.value as DirectGenerateResult;
              setTitle(result.title);
              setSelectedTopics(normalizeTopicList(result.tags));
              setTitleCandidates(result.titleCandidates.filter((candidate) => candidate.title !== result.title));
              setShowTitleCandidates(false);
              const cleanMarkdown = stripDuplicateTitleFromMarkdown(result.bodyMarkdown, result.title);
              writeEditorMarkup(markdownToEditorHtml(cleanMarkdown), cleanMarkdown);
              setChatInput("");
              setStatusMessage("AI 初稿已填充，正在生成图片...");
            }

            if (data.kind === "imageAsset") {
              const value = data.value as { asset?: GeneratedImageAsset; cover?: boolean };
              const asset = value.asset;
              if (!asset) return;
              generatedAssetIds.push(asset.id);
              setAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)]);
              setAssetIds((items) => Array.from(new Set([...generatedAssetIds, ...items])));
              if (value.cover) {
                setCoverPreview(asset.url);
                setCoverMode("single");
                setCoverPickerOpen(false);
              } else {
                insertAsset(asset);
              }
            }
          },
          onWarning: (message) => setStatusMessage(message),
          onDone: (_job, result) => {
            const generated = result as DirectGenerateResult;
            const ids = [
              generated.coverAsset?.id,
              ...(generated.imageAssets ?? []).map((item) => item.id),
            ].filter((id): id is string => Boolean(id));
            if (ids.length) setAssetIds((items) => Array.from(new Set([...ids, ...items])));
            if (generated.coverAsset?.url) setCoverPreview(generated.coverAsset.url);
            setStatusMessage(ids.length ? "AI 初稿和图片已填充到编辑区" : "AI 初稿已填充，图片稍后可单独生成");
          },
          onError: (message) => setStatusMessage(`AI 生成失败：${message}`),
        },
      );
      if (draftJob.status !== "succeeded") {
        throw new Error(draftJob.errorMessage ?? "AI 生成失败");
      }
      await loadAssets();
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `AI 生成失败：${error.message}`
          : "AI 生成失败",
      );
    } finally {
      setActiveOperation(null);
    }
  }

  // AI 生成封面图，优先使用创作简报的主题，如果没有则使用正文前40字作为主题，生成后加入素材库并设置为封面预览
  async function generateCoverImage() {
    const currentBody = editorText();
    const theme = title || briefTheme || currentBody.slice(0, 40);
    if (!theme) {
      setStatusMessage("请先填写标题或正文，再生成封面图");
      return;
    }
    if (isBusy) return;
    setActiveOperation("cover-image");
    setStatusMessage("AI 正在生成封面图...");
    try {
      const generated = { asset: null as GeneratedImageAsset | null };
      const imageJob = await runJob(
        () =>
          startCreativeImageJob({
            contentId: contentId ?? undefined,
            position: "封面",
            prompt: [
              `主题：${theme}`,
              "用途：今日头条信息流封面图，画面主体清晰，留出标题文字空间。",
              `当前标题：${title}`,
              `当前正文：${currentBody.slice(0, 1200)}`,
            ].join("\n"),
          }),
        {
          onProgress: (data) => {
            if (typeof data.message === "string") setStatusMessage(data.message);
          },
          onPartial: (data) => {
            if (data.kind !== "imageAsset") return;
            const value = data.value as { asset?: GeneratedImageAsset };
            if (value.asset) generated.asset = value.asset;
          },
          onDone: (_job, result) => {
            const value = result as { asset?: GeneratedImageAsset };
            if (value.asset) generated.asset = value.asset;
          },
          onError: (message) => setStatusMessage(`AI 封面生成失败：${message}`),
        },
      );
      if (imageJob.status !== "succeeded") {
        throw new Error(imageJob.errorMessage ?? "AI 封面生成失败");
      }
      const finalAsset = generated.asset;
      if (!finalAsset) {
        setStatusMessage("图片模型暂未返回封面图");
        return;
      }
      setCoverPreview(finalAsset.url);
      setCoverMode("single");
      setCoverPickerOpen(false);
      setAssetIds((items) => Array.from(new Set([finalAsset.id, ...items])));
      await loadAssets();
      setStatusMessage("AI 封面图已生成，并加入素材库");
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `AI 封面生成失败：${error.message}`
          : "AI 封面生成失败",
      );
    } finally {
      setActiveOperation(null);
    }
  }

  async function generateInlineImageFromText(prompt: string) {
    if (isBusy) return;
    setActiveOperation("inline-image");
    setStatusMessage("AI 正在生成正文配图...");
    try {
      const generated = { asset: null as GeneratedImageAsset | null };
      const imageJob = await runJob(
        () =>
          startCreativeImageJob({
            contentId: contentId ?? undefined,
            position: "正文配图",
            prompt: `配图需求：${prompt}\n当前标题：${title || briefTheme || "正文配图"}\n当前正文：${editorText().slice(0, 1000)}`,
          }),
        {
          onProgress: (data) => {
            if (typeof data.message === "string") setStatusMessage(data.message);
          },
          onPartial: (data) => {
            if (data.kind !== "imageAsset") return;
            const value = data.value as { asset?: GeneratedImageAsset };
            if (value.asset) generated.asset = value.asset;
          },
          onDone: (_job, result) => {
            const value = result as { asset?: GeneratedImageAsset };
            if (value.asset) generated.asset = value.asset;
          },
          onError: (message) => setStatusMessage(`AI 配图生成失败：${message}`),
        },
      );
      if (imageJob.status !== "succeeded") {
        throw new Error(imageJob.errorMessage ?? "AI 配图生成失败");
      }
      const finalAsset = generated.asset;
      if (!finalAsset) {
        setStatusMessage("图片模型暂未返回正文配图");
        return;
      }
      setAssets((items) => [
        finalAsset,
        ...items.filter((item) => item.id !== finalAsset.id),
      ]);
      insertAsset(finalAsset);
      setStatusMessage("AI 正文配图已生成并插入");
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `AI 配图生成失败：${error.message}`
          : "AI 配图生成失败",
      );
    } finally {
      setActiveOperation(null);
    }
  }

  async function generateSmartTitles() {
    const currentBody = editorText();
    if (!currentBody) {
      setStatusMessage("请先输入正文，再生成标题");
      return;
    }
    if (isBusy) return;
    setActiveOperation("title");
    try {
      const result = await generateCreativeTitles({
        currentTitle: title || undefined,
        body: currentBody,
        platform: "今日头条",
      });
      setTitleCandidates(result.candidates);
      setShowTitleCandidates(true);
      setStatusMessage("已生成标题候选");
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `智能标题失败：${error.message}`
          : "智能标题失败",
      );
    } finally {
      setActiveOperation(null);
    }
  }

  async function sendCreativeChatMessage() {
    const message = chatInput.trim();
    if (!message || isChatStreaming || streamLockRef.current) return;
    streamLockRef.current = true;
    setChatInput("");
    setIsChatStreaming(true);
    const userId = `user-${Date.now()}`;
    const assistantId = `assistant-${Date.now()}`;
    setChatMessages((items) => [
      ...items,
      { id: userId, role: "user", content: message },
      { id: assistantId, role: "assistant", content: "" },
    ]);
    try {
      await streamCreativeChat(
        {
          conversationId,
          contentId: contentId ?? undefined,
          message,
          currentTitle: title,
          currentBody: editorText(),
          selectedText: selectionMenu?.text,
        },
        {
          onMeta: (event) => setConversationId(event.conversationId),
          onDelta: (text) => {
            setChatMessages((items) =>
              items.map((item) =>
                item.id === assistantId
                  ? { ...item, content: `${item.content}${text}` }
                  : item,
              ),
            );
          },
          onDone: (event) => {
            setConversationId(event.conversationId);
            setChatMessages((items) =>
              items.map((item) =>
                item.id === assistantId
                  ? { ...item, id: event.messageId, insertable: true }
                  : item,
              ),
            );
            setStatusMessage("AI 回复完成，可插入正文或生成配图");
          },
          onError: (text) => setStatusMessage(text),
        },
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `AI 对话失败：${error.message}`
          : "AI 对话失败",
      );
    } finally {
      streamLockRef.current = false;
      setIsChatStreaming(false);
    }
  }

  async function rewriteSelected(action: "polish" | "expand" | "tone", toneOverride?: string) {
    const selectedText = editorRef.current?.getSelectedText() || "";
    if (!selectedText) {
      setStatusMessage("请先选中需要 AI 处理的文字");
      return;
    }
    if (isBusy) return;
    setActiveOperation("rewrite");
    try {
      const tone = toneOverride?.trim();
      const result = await rewriteSelection({
        selectedText,
        action,
        surroundingContext: editorText(),
        tone: action === "tone" ? tone || "亲和口语" : undefined,
      });
      editorRef.current?.replaceSelection(result.replacement);
      syncBodyFromEditor("AI 已处理选中内容");
      clearSelectionState();
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `选区改写失败：${error.message}`
          : "选区改写失败",
      );
    } finally {
      setActiveOperation(null);
    }
  }

  async function handleAssetUpload(file: File | undefined) {
    if (!file) return;
    const intent = uploadIntentRef.current;
    uploadIntentRef.current = "library";
    setIsUploadingAsset(true);
    try {
      const asset = await uploadAsset({
        file,
        contentId: contentId ?? undefined,
      });
      setAssets((items) => [
        asset,
        ...items.filter((item) => item.id !== asset.id),
      ]);
      setAssetIds((items) => Array.from(new Set([asset.id, ...items])));
      if (isImageAsset(asset)) {
        if (intent === "cover") {
          setCoverPreview(asset.url);
          setCoverMode("single");
          setCoverPickerOpen(false);
          setStatusMessage(`封面图已上传：${asset.fileName}`);
        } else if (intent === "insert") {
          insertAsset(asset);
        } else {
          if (!coverPreview) setCoverPreview(asset.url);
          setStatusMessage(`图片素材已上传：${asset.fileName}`);
        }
      } else {
        if (intent === "insert") insertAsset(asset);
        else setStatusMessage(`文本素材已上传：${asset.fileName}`);
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `素材上传失败：${error.message}`
          : "素材上传失败",
      );
    } finally {
      setIsUploadingAsset(false);
    }
  }

  function insertAsset(asset: AssetSummary) {
    setAssetIds((items) => Array.from(new Set([asset.id, ...items])));
    if (isImageAsset(asset)) {
      if (!editorRef.current) {
        const figure = `<figure><img src="${asset.url}" alt="${escapeHtml(asset.fileName)}" /></figure>`;
        writeEditorMarkup(`${editorHtml()}${figure}`, editorText());
        setStatusMessage("图片素材已插入正文");
        if (!coverPreview) setCoverPreview(asset.url);
        return;
      } else {
        editorRef.current.insertImage(asset.url, asset.fileName);
      }
      syncBodyFromEditor("图片素材已插入正文");
      if (!coverPreview) setCoverPreview(asset.url);
      return;
    }
    const preview = textAssetPreview(asset);
    insertHtml(
      markdownToEditorHtml(preview) || `<p>${escapeHtml(preview)}</p>`,
      "文本素材已插入正文",
    );
  }

  function removeCover() {
    setCoverPreview("");
    setCoverMode("none");
    setCoverPickerOpen(false);
    setStatusMessage("已移除封面");
  }

  function onAssetDragStart(
    event: DragEvent<HTMLDivElement>,
    asset: AssetSummary,
  ) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-aicp-asset-id", asset.id);
    draggedAssetRef.current = asset;
  }

  async function removeAsset(asset: AssetSummary) {
    const ok = window.confirm(`确定删除素材「${asset.fileName}」吗？`);
    if (!ok) return;
    try {
      await deleteAsset(asset.id);
      setAssets((items) => items.filter((item) => item.id !== asset.id));
      setAssetIds((items) => items.filter((id) => id !== asset.id));
      if (coverPreview === asset.url) setCoverPreview("");
      setStatusMessage("素材已删除");
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `删除素材失败：${error.message}`
          : "删除素材失败",
      );
    }
  }

  function openPreview() {
    const nextHtml = editorHtml() || textToEditorHtml(editorText());
    setPreviewHtml(nextHtml);
    syncBodyFromEditor();
    setShowPreview(true);
  }

  // 提交审核前先保存内容；这里只做安全合规，安全通过后即可发布。
  async function submitForReview() {
    if (isBusy) return;
    setActiveOperation("audit");
    setReviewRewrite(null);
    setStatusMessage("正在保存内容，准备内容审核...");
    try {
      const saved = await persistContent();
      setStatusMessage("内容已保存，正在内容审核...");
      const reviewJob = await runJob(
        () => startSubmitReviewJob(saved.id),
        {
          onProgress: (data) => {
            if (typeof data.message === "string") {
              setStatusMessage(data.message);
            } else if (typeof data.currentStep === "string") {
              setStatusMessage(data.currentStep);
            }
          },
          onPartial: (data) => {
            if (data.kind === "audit") setStatusMessage("审核结果已生成，正在更新作品状态");
          },
          onError: (message) => setStatusMessage(`内容审核失败：${message}`),
        },
      );
      if (reviewJob.status !== "succeeded" || !reviewJob.result) {
        throw new Error(reviewJob.errorMessage ?? "内容审核失败");
      }
      const reviewed = reviewJob.result as {
        content: ContentSummary;
        audit: AuditResult;
        quality: null;
        rewrite: ReviewRewrite;
      };

      console.log("审核结果", reviewed);

      setEditingStatus(reviewed.content.status);
      setLastContentSummary(reviewed.content);
      setReviewResult({ content: reviewed.content, audit: reviewed.audit });
      setQualityResult(null);
      if (reviewed.rewrite && !reviewed.audit.passed) {
        setReviewRewrite(reviewed.rewrite);
      }
      if (reviewed.audit.passed) setShowPreview(false);
      setStatusMessage(
        reviewed.audit.passed
          ? "安全审核通过，可直接发布；也可以先做质量评估作为分发参考"
          : `审核未通过：${reviewed.audit.reasons.join("；")}`,
      );
      await loadDraftCards();
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `内容审核失败：${error.message}`
          : "内容审核失败",
      );
    } finally {
      setActiveOperation(null);
    }
  }

  async function runQualityAssessment() {
    const targetId = contentId ?? lastContentSummary?.id;
    if (!targetId) {
      setStatusMessage("请先保存并内容审核后，再进行质量评估");
      return;
    }
    if (!canRunQualityReview) {
      setStatusMessage("内容需要先通过安全审核，才可以进行质量评估");
      return;
    }
    if (isBusy) return;

    setActiveOperation("quality");
    setStatusMessage("正在进行质量评估与打分...");
    try {
      const job = await runJob(
        () => startQualityScoreJob(targetId),
        {
          onProgress: (data) => {
            if (typeof data.message === "string") setStatusMessage(data.message);
          },
          onPartial: (data) => {
            if (data.kind === "quality") {
              setQualityResult(data.value as QualityScoreResult);
              setStatusMessage("质量评估已生成，正在更新作品状态");
            }
            if (data.kind === "content") {
              const content = data.value as ContentSummary;
              setLastContentSummary(content);
              setEditingStatus(content.status);
            }
          },
          onError: (message) => setStatusMessage(`质量评估失败：${message}`),
        },
      );
      if (job.status !== "succeeded" || !job.result) {
        throw new Error(job.errorMessage ?? "质量评估失败");
      }

      const approved = job.result as ContentApprovalResult;
      setLastContentSummary(approved.content);
      setEditingStatus(approved.content.status);
      setQualityResult(approved.quality);
      setStatusMessage(`质量评估完成，综合得分 ${approved.quality.total}`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `质量评估失败：${error.message}`
          : "质量评估失败",
      );
    } finally {
      setActiveOperation(null);
    }
  }

  async function publishCurrentContent() {
    const targetId = contentId ?? lastContentSummary?.id;
    if (!targetId) {
      setStatusMessage("请先保存内容后再发布");
      return;
    }
    if (!canPublishContent) {
      setStatusMessage("内容需要先通过安全审核后才能发布");
      return;
    }
    if (isBusy) return;

    setActiveOperation("publish");
    setStatusMessage("正在发布内容...");
    try {
      const published = await publishContent(targetId);
      setLastContentSummary(published);
      setEditingStatus(published.status);
      setStatusMessage("内容已发布，正在跳转作品管理");
      setPublishSuccess(true);
      publishRedirectTimerRef.current = window.setTimeout(() => {
        router.push("/content?status=published");
      }, 1100);
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `发布失败：${error.message}`
          : "发布失败",
      );
    } finally {
      setActiveOperation(null);
    }
  }

  function applyReplacement(replacement: ComplianceReplacement) {
    const riskItem = reviewResult?.audit.riskItems.find((item) => item.id === replacement.riskItemId);
    const changed = applyReplacementByRiskItem(replacement, riskItem);
    setStatusMessage(changed ? `已替换风险片段：${replacement.reason}` : "未找到可替换的风险片段");
  }

  function applyAllReplacements() {
    const replacements = reviewReplacements;
    if (!replacements.length) {
      setStatusMessage("暂无可逐条替换的风险片段");
      return;
    }

    let nextTitle = title;
    const riskItemsById = new Map((reviewResult?.audit.riskItems ?? []).map((item) => [item.id, item]));
    const sorted = [...replacements].sort((left, right) => {
      const leftItem = riskItemsById.get(left.riskItemId);
      const rightItem = riskItemsById.get(right.riskItemId);
      if ((leftItem?.field ?? "") !== (rightItem?.field ?? "")) {
        return (rightItem?.field ?? "").localeCompare(leftItem?.field ?? "");
      }
      return (rightItem?.startOffset ?? -1) - (leftItem?.startOffset ?? -1);
    });

    let changed = 0;
    const bodyReplacements: Array<{
      original: string;
      replacement: string;
      startOffset?: number;
      endOffset?: number;
    }> = [];

    for (const replacement of sorted) {
      const riskItem = riskItemsById.get(replacement.riskItemId);
      if (riskItem?.field === "title") {
        const result = replaceInTextByRiskItem(nextTitle, replacement, riskItem);
        if (!result.changed) continue;
        nextTitle = result.text;
        changed += 1;
      } else {
        bodyReplacements.push({
          original: riskItem?.evidence || replacement.original,
          replacement: replacement.replacement,
          startOffset: riskItem?.startOffset,
          endOffset: riskItem?.endOffset,
        });
      }
    }

    if (bodyReplacements.length && editorRef.current) {
      changed += editorRef.current.replaceTextRanges(bodyReplacements);
      syncBodyFromEditor();
    } else if (bodyReplacements.length) {
      let nextBody = editorText();
      for (const replacement of sorted) {
        const riskItem = riskItemsById.get(replacement.riskItemId);
        if (riskItem?.field === "title") continue;
        const result = replaceInTextByRiskItem(nextBody, replacement, riskItem);
        if (!result.changed) continue;
        nextBody = result.text;
        changed += 1;
      }
      writeEditorMarkup(textToEditorHtml(nextBody), nextBody);
    }

    if (changed > 0 || nextTitle !== title) {
      setTitle(nextTitle);
    }
    setStatusMessage(changed ? `已替换 ${changed} 个风险片段` : "未找到可替换的风险片段");
  }

  function applyReplacementByRiskItem(replacement: ComplianceReplacement, riskItem?: AuditRiskItem) {
    if (riskItem?.field === "title") {
      const result = replaceInTextByRiskItem(title, replacement, riskItem);
      if (result.changed) setTitle(result.text);
      return result.changed;
    }

    if (editorRef.current) {
      const changed = editorRef.current.replaceTextRange({
        original: riskItem?.evidence || replacement.original,
        replacement: replacement.replacement,
        startOffset: riskItem?.startOffset,
        endOffset: riskItem?.endOffset,
      });
      if (changed) syncBodyFromEditor();
      return changed;
    }

    const result = replaceInTextByRiskItem(editorText(), replacement, riskItem);
    if (result.changed) writeEditorMarkup(textToEditorHtml(result.text), result.text);
    return result.changed;
  }

  function replaceInTextByRiskItem(text: string, replacement: ComplianceReplacement, riskItem?: AuditRiskItem) {
    const original = replacement.original || riskItem?.evidence || "";
    if (
      riskItem?.startOffset !== undefined &&
      riskItem.endOffset !== undefined &&
      text.slice(riskItem.startOffset, riskItem.endOffset) === original
    ) {
      return {
        changed: true,
        text: `${text.slice(0, riskItem.startOffset)}${replacement.replacement}${text.slice(riskItem.endOffset)}`,
      };
    }

    if (!original || !text.includes(original)) {
      return { changed: false, text };
    }
    return { changed: true, text: text.replace(original, replacement.replacement) };
  }

  function addTopic(topic: string) {
    const name = normalizeTopicName(topic);
    if (!name) return;
    setSelectedTopics((items) => normalizeTopicList([...items, name]));
    setCustomTopicInput("");
    setStatusMessage("已将话题添加到正文");
  }

  if (isLoadingInitial) {
    return (
      <div className="grid min-h-full place-items-center text-sm font-semibold text-slate-500">
        正在打开创作中心...
      </div>
    );
  }

  return (
    <section className="min-h-full bg-[#f6f6f7] px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-440 gap-5 xl:grid-cols-[320px_minmax(0,1fr)_390px]">
        <aside className="space-y-5 xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto xl:pr-1">
          <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex rounded-2xl bg-slate-100 p-1">
              {[
                ["brief", "基础需求"],
                ["assets", "素材管理"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPrepTab(value as PrepTab)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${prepTab === value ? "bg-white text-[#ff2442] shadow-sm" : "text-slate-500"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {prepTab === "brief" ? (
              <div className="space-y-3">
                <Field
                  label="主题"
                  value={briefTheme}
                  onChange={setBriefTheme}
                  placeholder="例如：夏日通勤穿搭"
                />
                <Field
                  label="目标人群"
                  value={audience}
                  onChange={setAudience}
                  placeholder="例如：20-30 岁职场女性"
                />
                <Field
                  label="风格"
                  value={style}
                  onChange={setStyle}
                  placeholder="例如：清爽、实用、有生活感"
                />
                <Field
                  label="核心观点"
                  value={viewpoint}
                  onChange={setViewpoint}
                  placeholder="例如：少量单品也能穿出松弛感"
                />
                <button
                  type="button"
                  onClick={() => void createAiDraft("brief")}
                  disabled={isBusy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#ff2442] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#e91635] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Sparkles size={16} />
                  {isOperation("draft") ? "AI 生成中..." : "AI 一键生成初稿"}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => openImageUpload("library")}
                    className="rounded-2xl bg-[#fff3f5] px-4 py-3 text-sm font-semibold text-[#ff2442]"
                  >
                    上传图片
                  </button>
                  <button
                    type="button"
                    onClick={openTextUpload}
                    className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700"
                  >
                    上传文本
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setAssetPanel("image")}
                  className="flex w-full items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700"
                >
                  <span className="inline-flex items-center gap-2">
                    <ImagePlus size={16} />
                    图片素材库
                  </span>
                  <span>{imageAssets.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAssetPanel("text")}
                  className="flex w-full items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700"
                >
                  <span className="inline-flex items-center gap-2">
                    <FileText size={16} />
                    文本素材库
                  </span>
                  <span>{textAssets.length}</span>
                </button>
                <p className="text-xs leading-5 text-slate-400">
                  素材会保存到个人素材库，可在素材库中统一管理。
                </p>
              </div>
            )}
          </section>
        </aside>

        <main className="space-y-5">
          {drafts.length ? (
            <section className="rounded-[28px] border border-slate-100 bg-white px-5 py-4 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="flex shrink-0 items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-2xl bg-[#fff3f5] text-[#ff2442]">
                    <FileText size={18} />
                  </span>
                  <div>
                    <h2 className="text-sm font-black text-slate-950">
                      草稿箱
                    </h2>
                    <p className="text-xs text-slate-400">
                      {drafts.length} 篇未完成内容
                    </p>
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto pb-1">
                  {drafts.slice(0, 3).map((draft) => (
                    <div
                      key={draft.id}
                      className={`relative min-w-55 rounded-2xl pr-10 transition ${
                        draft.id === contentId
                          ? "bg-[#fff3f5] text-[#ff2442]"
                          : "bg-slate-50 text-slate-700 hover:bg-[#fff3f5] hover:text-[#ff2442]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void openDraftCard(draft.id)}
                        className="w-full px-4 py-3 text-left"
                      >
                        <p className="truncate text-sm font-bold">
                          {draft.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          保存于 {formatTime(draft.updatedAt)}
                        </p>
                        {draft.body ? (
                          <p className="mt-2 line-clamp-1 text-xs leading-5 text-slate-500">
                            {draft.body}
                          </p>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteDraftCard(draft)}
                        className="absolute right-2 top-2 grid size-8 place-items-center rounded-full text-slate-400 transition hover:bg-white hover:text-[#ff2442]"
                        title="删除作品"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <section className="relative rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
              <span>
                {isOnline ? "在线编辑" : "离线编辑"} · {statusMessage}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void autoSaveDraft(true)}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600"
                >
                  保存
                </button>
              </div>
            </div>

            <div className="relative">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="填写标题会有更多赞哦"
                className="w-full rounded-2xl border border-transparent bg-slate-50 px-4 py-4 pr-16 text-xl font-bold outline-none placeholder:text-slate-300 focus:border-[#ff2442]/20 focus:bg-white"
              />
              <button
                type="button"
                onClick={() => void generateSmartTitles()}
                disabled={isBusy}
                className="absolute right-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white text-[#ff2442] shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                title="智能标题"
              >
                <Wand2 size={18} />
              </button>
            </div>

            {showTitleCandidates ? (
              <div className="mt-3 grid gap-2 rounded-2xl bg-[#fff3f5] p-3">
                {titleCandidates.map((candidate) => (
                  <button
                    key={candidate.title}
                    type="button"
                    onClick={() => {
                      setTitle(candidate.title);
                      setShowTitleCandidates(false);
                    }}
                    className="rounded-xl bg-white px-3 py-2 text-left text-sm transition hover:text-[#ff2442]"
                  >
                    <strong>{candidate.title}</strong>
                    <span className="ml-2 text-xs text-slate-400">
                      {candidate.reason}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <RichTextEditor
              ref={editorRef}
              initialContent={{
                html: editorHtmlContent,
                json: editorJsonContent,
                text: body,
              }}
              resetKey={editorResetKey}
              onChange={(value) => syncRichTextValue(value)}
              onSelectionChange={(selection: RichTextSelection | null) => {
                setToneMenuOpen(false);
                setSelectionMenu(selection);
              }}
              onSaveShortcut={() => void autoSaveDraft(true)}
              onOpenImageUpload={() => openImageUpload("insert")}
            />

            {selectionMenu ? (
              <div
                className="fixed z-50 flex max-w-[min(92vw,520px)] -translate-x-1/2 flex-wrap items-center gap-1 rounded-2xl border border-slate-100 bg-white p-1 text-xs font-semibold shadow-xl"
                style={{ top: selectionMenu.top, left: selectionMenu.left }}
                onMouseDown={(event) => event.preventDefault()}
              >
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void rewriteSelected("polish")}
                  disabled={isBusy}
                  className="rounded-full px-3 py-1.5 text-slate-600 hover:bg-[#fff3f5] hover:text-[#ff2442] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  润色
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void rewriteSelected("expand")}
                  disabled={isBusy}
                  className="rounded-full px-3 py-1.5 text-slate-600 hover:bg-[#fff3f5] hover:text-[#ff2442] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  扩写
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setToneMenuOpen((value) => !value)}
                  className={`rounded-full px-3 py-1.5 ${toneMenuOpen ? "bg-[#fff3f5] text-[#ff2442]" : "text-slate-600 hover:bg-[#fff3f5] hover:text-[#ff2442]"}`}
                >
                  改语气
                </button>
                {toneMenuOpen ? (
                  <div className="flex w-full flex-wrap items-center gap-1 border-t border-slate-100 px-1 pt-1">
                    {tonePresets.map((tone) => (
                      <button
                        key={tone}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => void rewriteSelected("tone", tone)}
                        disabled={isBusy}
                        className="rounded-full bg-slate-50 px-3 py-1.5 text-slate-600 hover:bg-[#fff3f5] hover:text-[#ff2442] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {tone}
                      </button>
                    ))}
                    <input
                      value={customTone}
                      onChange={(event) => setCustomTone(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          customTone.trim() &&
                          !isBusy
                        ) {
                          event.preventDefault();
                          void rewriteSelected("tone", customTone);
                        }
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      placeholder="自定义语气"
                      className="min-w-28 flex-1 rounded-full bg-slate-50 px-3 py-1.5 text-slate-700 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-[#ff2442]/20"
                    />
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        customTone.trim() &&
                        void rewriteSelected("tone", customTone)
                      }
                      className="rounded-full bg-[#ff2442] px-3 py-1.5 text-white disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isBusy || !customTone.trim()}
                    >
                      应用
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {selectedTopics.map((topic) => {
                const topicName = normalizeTopicName(topic);
                return (
                  <button
                    key={topic}
                    type="button"
                    onClick={() =>
                      setSelectedTopics((items) =>
                        items.filter((item) => item !== topic),
                      )
                    }
                    className="rounded-full bg-[#fff3f5] px-3 py-1.5 text-sm font-semibold text-[#ff2442]"
                  >
                    #{topicName} ×
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setQuickMenu(quickMenu === "topic" ? null : "topic")
                }
                className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                <Hash className="mr-1 inline h-4 w-4" />
                话题
              </button>
              <button
                type="button"
                onClick={() =>
                  setQuickMenu(quickMenu === "emoji" ? null : "emoji")
                }
                className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                <Smile className="mr-1 inline h-4 w-4" />
                表情
              </button>
              <span className="ml-auto text-sm text-slate-400">
                {wordCount}/10000
              </span>
            </div>

            {quickMenu === "topic" ? (
              <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                <div className="flex gap-2">
                  <input
                    value={customTopicInput}
                    onChange={(event) =>
                      setCustomTopicInput(event.target.value)
                    }
                    placeholder="输入自定义话题"
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
                  />
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addTopic(customTopicInput)}
                    className="rounded-xl bg-[#ff2442] px-4 text-sm font-semibold text-white"
                  >
                    添加
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {recommendedTopics.map((topic) => (
                    <button
                      key={topic.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addTopic(topic.title)}
                      className="rounded-full bg-white px-3 py-1.5 text-sm text-slate-600 hover:text-[#ff2442]"
                    >
                      #{topic.title}
                    </button>
                  ))}
                  {!recommendedTopics.length ? (
                    <span className="text-sm text-slate-400">
                      正文里暂时没有匹配到可推荐的话题
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {quickMenu === "emoji" ? (
              <div className="mt-3 flex flex-wrap gap-2 rounded-2xl bg-slate-50 p-3">
                {emojiSuggestions.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => insertText(emoji, "已插入表情")}
                    className="grid size-10 place-items-center rounded-xl bg-white text-lg"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-slate-950">内容设置</h2>
            <div className="space-y-5">
              <div className="space-y-3">
                <div className="flex min-h-14 w-full flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="flex items-center gap-3 text-base text-slate-700">
                    <ImagePlus size={18} className="text-slate-500" />
                    展示封面
                  </span>
                  <div className="flex rounded-full bg-white p-1 shadow-sm">
                    {(["single", "none"] as CoverMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setCoverMode(mode)}
                        className={`h-8 rounded-full px-4 text-sm transition ${
                          coverMode === mode
                            ? "bg-[#ff2442] font-bold text-white"
                            : "text-slate-500 hover:text-[#ff2442]"
                        }`}
                      >
                        {coverModeLabels[mode]}
                      </button>
                    ))}
                  </div>
                </div>

                {coverMode !== "none" ? (
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      {coverPreview ? (
                        <div className="relative">
                          <img
                            src={coverPreview}
                            alt="封面预览"
                            onError={() => setCoverPreview("")}
                            className="h-24 w-36 rounded-2xl object-cover"
                          />
                          <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-1 text-sm font-semibold text-white">
                            当前封面
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openImageUpload("cover")}
                          className="flex h-24 w-36 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-slate-500 transition hover:border-[#ff2442]/40 hover:bg-[#fff3f5] hover:text-[#ff2442]"
                        >
                          <ImagePlus size={22} />
                          <span className="mt-2 text-sm font-semibold">添加封面</span>
                        </button>
                      )}
                      <div className="min-w-56 flex-1">
                        <p className="text-base text-slate-500">
                          支持上传封面或使用 AI 生成，发布前可随时切换。
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openImageUpload("cover")}
                            className="h-9 rounded-xl bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:text-[#ff2442]"
                          >
                            上传封面
                          </button>
                          <button
                            type="button"
                            onClick={() => void generateCoverImage()}
                            disabled={isBusy || imageConfig?.configured === false}
                            className="h-9 rounded-xl bg-[#ff2442] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isOperation("cover-image") ? "生成中..." : "AI 生成"}
                          </button>
                          {coverPreview ? (
                            <button
                              type="button"
                              onClick={removeCover}
                              className="h-9 rounded-xl bg-rose-50 px-4 text-base font-bold text-rose-600"
                            >
                              移除
                            </button>
                          ) : null}
                        </div>
                        {imageConfig?.configured === false ? (
                          <p className="mt-2 text-xs text-rose-500">
                            文生图配置缺失：{imageConfig.missing.join("、")}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setOriginalStatement((value) => !value)}
                  className="flex h-14 w-full items-center justify-between rounded-2xl bg-slate-50 px-4 text-left transition hover:bg-slate-100"
                >
                  <span className="flex items-center gap-3 text-base text-slate-700">
                    <ShieldCheck size={18} className="text-slate-500" />
                    原创声明
                  </span>
                  <span className={`relative h-8 w-14 rounded-full transition ${originalStatement ? "bg-[#ff2442]" : "bg-slate-300"}`}>
                    <span className={`absolute top-1 size-6 rounded-full bg-white shadow-sm transition ${originalStatement ? "left-7" : "left-1"}`} />
                  </span>
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setContentStatementOpen((value) => !value)}
                    className="flex h-14 w-full items-center justify-between rounded-2xl bg-slate-50 px-4 text-left transition hover:bg-slate-100"
                  >
                    <span className="flex min-w-0 items-center gap-3 text-base text-slate-700">
                      <FileText size={18} className="text-slate-500" />
                      <span className="truncate">
                        {contentStatement === "无声明" ? "添加内容类型声明" : contentStatement}
                      </span>
                    </span>
                    <ChevronDown size={18} className={`shrink-0 text-slate-500 transition ${contentStatementOpen ? "rotate-180" : ""}`} />
                  </button>
                  {contentStatementOpen ? (
                    <div className="mt-2 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-lg">
                      {contentStatements.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => {
                            setContentStatement(item);
                            setContentStatementOpen(false);
                          }}
                          className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition hover:bg-slate-50 ${
                            contentStatement === item ? "font-bold text-[#ff2442]" : "font-medium text-slate-700"
                          }`}
                        >
                          {item === "无声明" ? "不添加内容类型声明" : item}
                          {contentStatement === item ? <CheckCircle2 size={16} /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setLocationPickerOpen((value) => !value)}
                    className="flex h-14 w-full items-center justify-between rounded-2xl bg-slate-50 px-4 text-left transition hover:bg-slate-100"
                  >
                    <span className="flex min-w-0 items-center gap-3 text-base text-slate-700">
                      <MapPin size={18} className="text-slate-500" />
                      <span className="truncate">{selectedLocation || "添加地点"}</span>
                    </span>
                    <ChevronDown size={18} className={`shrink-0 text-slate-500 transition ${locationPickerOpen ? "rotate-180" : ""}`} />
                  </button>

                  {locationPickerOpen ? (
                    <div className="mt-2 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl">
                      <div className="border-b border-slate-100 p-3">
                        <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 transition focus-within:ring-4 focus-within:ring-[#ff2442]/10">
                          <Search size={15} className="text-slate-400" />
                          <input
                            value={searchKeyword}
                            onChange={(event) => setSearchKeyword(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handleSearchLocation(searchKeyword);
                              }
                            }}
                            placeholder="搜索地点、商圈或景点"
                            className="min-w-0 flex-1 bg-transparent text-base text-slate-800 outline-none placeholder:text-slate-400"
                          />
                          <button
                            type="button"
                            onClick={() => void handleSearchLocation(searchKeyword)}
                            disabled={isSearchingLocation || !searchKeyword.trim()}
                            className="h-8 text-base font-bold text-slate-800 transition hover:text-[#ff2442] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSearchingLocation ? "搜索中" : "搜索"}
                          </button>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => void refreshNearbyLocations(true)}
                            disabled={locationStatus === "locating"}
                            className="font-bold text-slate-500 transition hover:text-[#ff2442] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {locationStatus === "locating" ? "定位中..." : "重新获取附近地点"}
                          </button>
                          {selectedLocation ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedLocation("");
                                setLocationPickerOpen(false);
                              }}
                              className="font-bold text-slate-400 transition hover:text-[#ff2442]"
                            >
                              清除地点
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="max-h-72 overflow-y-auto py-1">
                        {locationCandidates.length ? (
                          locationCandidates.map((location) => (
                            <button
                              key={location.id}
                              type="button"
                              onClick={() => {
                                setSelectedLocation(location.name);
                                setLocationPickerOpen(false);
                              }}
                              className="block w-full px-5 py-3 text-left transition hover:bg-slate-50"
                            >
                              <span className="block text-base font-semibold text-slate-900">
                                {location.name}
                              </span>
                              <span className="mt-1 block truncate text-xs text-slate-400">
                                {location.address || "附近地点"}
                                {location.distance !== undefined ? ` · ${Math.round(location.distance)}m` : ""}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="px-5 py-6 text-sm text-slate-400">
                            {locationStatus === "locating"
                              ? "正在获取附近地点..."
                              : "暂无地点候选，可以输入关键词搜索。"}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-slate-950">发布设置</h2>
            <div className="space-y-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setVisibilityOpen((value) => !value)}
                  className="flex h-14 w-full items-center justify-between rounded-2xl bg-slate-50 px-4 text-left transition hover:bg-slate-100"
                >
                  <span className="flex min-w-0 items-center gap-3 text-base text-slate-700">
                    <Eye size={18} className="text-slate-500" />
                    <span className="truncate">谁可以看：{visibilityLabels[visibility]}</span>
                  </span>
                  <ChevronDown size={18} className={`shrink-0 text-slate-500 transition ${visibilityOpen ? "rotate-180" : ""}`} />
                </button>
                {visibilityOpen ? (
                  <div className="mt-2 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-lg">
                    {(["public", "followers", "private"] as Visibility[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setVisibility(value);
                          setVisibilityOpen(false);
                        }}
                        className={`flex w-full items-center justify-between px-4 py-3 text-left text-base transition hover:bg-slate-50 ${
                          visibility === value ? "font-bold text-[#ff2442]" : "text-slate-700"
                        }`}
                      >
                        {visibilityLabels[value]}
                        {visibility === value ? <CheckCircle2 size={16} /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPublishTimeOpen((value) => !value)}
                  className="flex h-14 w-full items-center justify-between rounded-2xl bg-slate-50 px-4 text-left transition hover:bg-slate-100"
                >
                  <span className="flex min-w-0 items-center gap-3 text-base text-slate-700">
                    <Clock3 size={18} className="text-slate-500" />
                    <span className="truncate">
                      发布时间：{publishTimeMode === "scheduled" && scheduledAt ? `${scheduledDate()} ${scheduledTime() || ""}` : publishTimeLabels[publishTimeMode]}
                    </span>
                  </span>
                  <ChevronDown size={18} className={`shrink-0 text-slate-500 transition ${publishTimeOpen ? "rotate-180" : ""}`} />
                </button>
                {publishTimeOpen ? (
                  <div className="mt-2 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-lg">
                    {(["now", "scheduled"] as PublishTimeMode[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPublishTimeMode(value)}
                        className={`flex w-full items-center justify-between px-4 py-3 text-left text-base transition hover:bg-slate-50 ${
                          publishTimeMode === value ? "font-bold text-[#ff2442]" : "text-slate-700"
                        }`}
                      >
                        {publishTimeLabels[value]}
                        {publishTimeMode === value ? <CheckCircle2 size={16} /> : null}
                      </button>
                    ))}

                    {publishTimeMode === "scheduled" ? (
                      <div className="border-t border-slate-100 bg-slate-50 p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="text-xs font-bold text-slate-500">
                            日期
                            <input
                              type="date"
                              value={scheduledDate()}
                              onChange={(event) => updateScheduledAtPart("date", event.target.value)}
                              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-800 outline-none transition focus:border-[#ff2442]/40 focus:ring-4 focus:ring-[#ff2442]/10"
                            />
                          </label>
                          <label className="text-xs font-bold text-slate-500">
                            时间
                            <input
                              type="time"
                              value={scheduledTime()}
                              disabled={!scheduledDate()}
                              onChange={(event) => updateScheduledAtPart("time", event.target.value)}
                              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-800 outline-none transition focus:border-[#ff2442]/40 focus:ring-4 focus:ring-[#ff2442]/10 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                          </label>
                        </div>
                        {scheduledAt ? (
                          <button
                            type="button"
                            onClick={() => setScheduledAt("")}
                            className="mt-3 text-xs font-bold text-slate-500 transition hover:text-[#ff2442]"
                          >
                            清除定时
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">发布流转</h2>
              {editingStatus ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                  {contentStatusLabels[editingStatus]}
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <button
                type="button"
                onClick={openPreview}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 text-base font-bold text-slate-700 transition hover:bg-slate-200"
              >
                预览
              </button>
              <button
                type="button"
                onClick={() => void submitForReview()}
                disabled={isBusy}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#ff2442] px-4 text-base font-bold text-white transition hover:bg-[#e91635] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isOperation("audit") ? "审核中..." : "内容审核"}
              </button>
              <button
                type="button"
                onClick={() => void runQualityAssessment()}
                disabled={isBusy || !canRunQualityReview}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-50 px-4 text-base font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isOperation("quality") ? "评估中..." : "质量评估"}
              </button>
              <button
                type="button"
                onClick={() => void publishCurrentContent()}
                disabled={isBusy || !canPublishContent}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#ff2442] px-4 text-base font-bold text-white transition hover:bg-[#e91635] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isOperation("publish") ? "发布中..." : "发布"}
              </button>
            </div>

            {reviewResult ? (
              <div
                className={`mt-3 rounded-2xl p-3 text-sm ${
                  reviewResult.audit.passed
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-rose-50 text-rose-800"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-bold">
                    {reviewResult.audit.passed
                      ? "安全审核通过"
                      : "安全审核未通过"}
                  </p>
                  {!reviewResult.audit.passed && reviewReplacements.length ? (
                    <button
                      type="button"
                      onClick={applyAllReplacements}
                      className="shrink-0 rounded-full bg-[#ff2442] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-rose-100"
                    >
                      一键替换全部风险片段
                    </button>
                  ) : null}
                </div>
                {visibleReviewRiskItems.length ? (
                  <div className="mt-3 grid gap-2">
                    {visibleReviewRiskItems.map((item) => {
                      const replacement = reviewReplacementByRiskItem.get(
                        item.id,
                      );
                      return (
                        <div
                          key={item.id}
                          className="rounded-xl bg-white/80 p-3 text-sm text-slate-700"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 items-center justify-center font-bold ${riskSeverityClass(item.severity)}`}
                            >
                              {riskSeverityLabel(item.severity)}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 items-center justify-center font-bold text-slate-600">
                              {riskTypeLabel(item.type)}
                            </span>
                            <span className="font-semibold text-slate-400">
                              置信度 {Math.round(item.confidence * 100)}%
                            </span>
                          </div>
                          <p className="mt-2 font-semibold text-slate-900">
                            风险片段：{item.evidence}
                          </p>
                          <p className="mt-1 leading-5 italic text-xs">
                            {item.reason}
                          </p>
                          {replacement ? (
                            <div className="flex flex-wrap items-center justify-between mt-2 rounded-xl bg-rose-50 px-3 py-2 text-rose-900">
                              <p className="font-bold">
                                替代表达：{replacement.replacement}
                              </p>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => applyReplacement(replacement)}
                                  className="shrink-0 rounded-full bg-white px-3 py-1 font-bold text-[#ff2442] shadow-sm transition hover:bg-[#fff3f5]"
                                >
                                  替换该片段
                                </button>
                              </div>
                            </div>
                          ) : item.suggestion ? (
                            <p className="mt-1 text-slate-500">
                              建议：{item.suggestion}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {qualityResult ? (
              <div className="mt-3 rounded-2xl border border-emerald-100 bg-white p-3 shadow-sm">
                {/* 头部：总分看板 */}
                <div className="flex items-center justify-between border-b border-emerald-50 pb-4">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-wider text-emerald-800">
                      质量综合分
                    </p>
                    <p className="mt-1 flex items-baseline gap-1.5 text-4xl font-black text-emerald-600">
                      {qualityResult.total}
                      <span className="text-sm font-bold text-emerald-600/40">
                        / 100
                      </span>
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
                    分发参考
                  </span>
                </div>

                {/* 中部核心区：采用 grid 动态分栏 */}
                <div className="mt-6 grid grid-cols-1 items-center gap-8 md:grid-cols-12">
                  {/* 左侧：放大的雷达图，占据 7/12 的宽度 */}
                  <div className="mx-auto w-full md:col-span-7 md:max-w-full p-2">
                    <QualityRadarChart quality={qualityResult} />
                  </div>

                  {/* 右侧：得分列表，占据 5/12 的宽度 */}
                  <div className="flex flex-col gap-2 md:col-span-5">
                    {Object.entries(qualityResult.dimensions).map(
                      ([key, value]) => (
                        <div
                          key={key}
                          className="flex items-center justify-between rounded-2xl bg-slate-50/80 border border-slate-100 px-4 py-3 shadow-2xs"
                        >
                          <span className="text-sm font-bold text-slate-500">
                            {
                              qualityDimensionLabels[
                                key as keyof QualityScoreResult["dimensions"]
                              ]
                            }
                          </span>
                          <span className="text-sm font-black text-slate-800">
                            {value}
                            <span className="ml-0.5 font-normal text-slate-400">
                              /20
                            </span>
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </div>

                {/* 底部：AI 详细评价 */}
                <div className="mt-6 rounded-2xl bg-emerald-50/40 border border-emerald-100/50 p-4">
                  <p className="text-sm leading-6 text-emerald-800">
                    <span className="font-extrabold text-emerald-700">
                      AI 诊断报告：
                    </span>
                    {qualityResult.reason}
                  </p>
                </div>
              </div>
            ) : lastContentSummary?.qualityScore ? (
              <div className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">
                当前质量分：<strong>{lastContentSummary.qualityScore}</strong>
              </div>
            ) : null}
          </section>
        </main>

        <aside className="space-y-5 xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] xl:pr-1">
          <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-slate-950">
              <MessageCircle size={18} className="text-[#ff2442]" />
              <h2 className="font-bold">AI 交互中心</h2>
            </div>
            <div className="mb-4 flex rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setAiMode("brainstorm")}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${aiMode === "brainstorm" ? "bg-white text-[#ff2442] shadow-sm" : "text-slate-500"}`}
              >
                碰撞思路
              </button>
              <button
                type="button"
                onClick={() => setAiMode("direct")}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${aiMode === "direct" ? "bg-white text-[#ff2442] shadow-sm" : "text-slate-500"}`}
              >
                直接生成
              </button>
            </div>

            {aiMode === "brainstorm" ? (
              <div>
                {!chatMessages.length ? (
                  <div className="space-y-2">
                    {defaultIdeas.map((idea) => (
                      <button
                        key={idea}
                        type="button"
                        onClick={() => setChatInput(idea)}
                        className="w-full rounded-2xl bg-slate-50 px-4 py-3 text-left text-sm text-slate-600 hover:bg-[#fff3f5] hover:text-[#ff2442]"
                      >
                        {idea}
                      </button>
                    ))}
                  </div>
                ) : null}
                {chatMessages.length ? (
                  <div className="max-h-[58vh] min-h-80 space-y-3 overflow-y-auto pr-1">
                    {chatMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-[#fff3f5] text-rose-900" : "border border-slate-100 bg-white text-slate-700 shadow-sm"}`}
                      >
                        <div className="mb-1 text-xs font-semibold text-slate-400">
                          {message.role === "user" ? "你" : "AI"}
                        </div>
                        {message.role === "assistant" ? (
                          <div className="[&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {message.content || "AI 正在思考..."}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap">
                            {message.content}
                          </p>
                        )}
                        {message.role === "assistant" &&
                        message.insertable &&
                        message.content.trim() ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                insertHtml(
                                  markdownToEditorHtml(message.content),
                                  "AI 回复已插入正文",
                                )
                              }
                              className="inline-flex items-center gap-1 rounded-full bg-[#ff2442] px-3 py-1 text-xs font-medium text-white"
                            >
                              <Copy size={13} />
                              插入正文
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void generateInlineImageFromText(
                                  message.content,
                                )
                              }
                              disabled={isBusy}
                              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-[#fff3f5] hover:text-[#ff2442] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <ImagePlus size={13} />
                              {isOperation("inline-image")
                                ? "生成中..."
                                : "生成配图"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl bg-[#fff3f5] p-4 text-sm leading-6 text-rose-900">
                输入最终确定的主题或思路，AI
                会直接把完整图文、标签和图片资产填入中央编辑区。
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-2">
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                rows={4}
                placeholder={
                  aiMode === "brainstorm"
                    ? "输入你的疑问，和 AI 一起拆角度..."
                    : "输入最终主题，AI 将生成完整图文..."
                }
                className="w-full resize-none bg-transparent p-2 text-sm outline-none placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={() =>
                  aiMode === "direct"
                    ? void createAiDraft("direct")
                    : void sendCreativeChatMessage()
                }
                disabled={isBusy || isChatStreaming}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff2442] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Sparkles size={16} />
                {isChatStreaming
                  ? "AI 输出中..."
                  : aiMode === "direct"
                    ? isOperation("draft")
                      ? "生成中..."
                      : "生成到编辑区"
                    : "发送给 AI"}
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">伴随式建议</h2>
              <ShieldCheck size={18} className="text-[#ff2442]" />
            </div>
            <div className="space-y-3">
              {wordCount < 120 ? (
                <AssistCard
                  title="补齐正文结构"
                  desc="当前正文偏短，建议加入场景痛点、方法清单和结尾行动点。"
                  onClick={() =>
                    insertHtml(
                      "<p><strong>补充结构：</strong>场景痛点 - 实用方法 - 读者行动建议。</p>",
                      "已插入结构建议",
                    )
                  }
                />
              ) : null}
              {!coverPreview ? (
                <AssistCard
                  title="封面还未准备"
                  desc="建议添加一张清晰封面，提升信息流识别度。"
                  onClick={() => openImageUpload("cover")}
                />
              ) : null}
              {body.trim() && !title.trim() ? (
                <AssistCard
                  title="可以生成标题"
                  desc="AI 可基于正文生成 5 个标题候选。"
                  onClick={() => void generateSmartTitles()}
                />
              ) : null}
              {imageConfig?.configured === false ? (
                <AssistCard
                  title="文生图配置未完整"
                  desc={imageConfig.missing.join("、")}
                  onClick={() => void loadImageConfig()}
                />
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleAssetUpload(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={textInputRef}
        type="file"
        accept=".txt,.md,text/plain,text/markdown"
        className="hidden"
        onChange={(event) => {
          void handleAssetUpload(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

      {assetPanel ? (
        <AssetPanel
          mode={assetPanel}
          assets={assetPanel === "image" ? imageAssets : textAssets}
          uploading={isUploadingAsset}
          onClose={() => setAssetPanel(null)}
          onUpload={() =>
            assetPanel === "image"
              ? openImageUpload("library")
              : openTextUpload()
          }
          onInsert={insertAsset}
          onDelete={(asset) => void removeAsset(asset)}
          onDragStart={onAssetDragStart}
        />
      ) : null}

      {publishSuccess ? (
        <div className="fixed inset-0 z-60 grid place-items-center bg-black/35 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={30} />
            </div>
            <h3 className="mt-4 text-xl font-black text-slate-950">已发布</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              内容已进入已发布列表，正在跳转作品管理。
            </p>
          </div>
        </div>
      ) : null}

      {showPreview ? (
        <div className="fixed inset-0 z-50">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => setShowPreview(false)}
          />
          <div className="fixed inset-0 overflow-y-auto px-4 py-10">
            <div className="relative z-10 mx-auto w-full max-w-3xl rounded-3xl bg-white p-6 shadow-xl">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-950">发布预览</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPreview(false)}
                  className="rounded-full p-2 hover:bg-slate-50"
                >
                  <X size={16} />
                </button>
              </div>
              {coverMode !== "none" && coverPreview ? (
                <img
                  src={coverPreview}
                  alt="封面预览"
                  onError={() => setCoverPreview("")}
                  className="mb-5 h-56 w-full rounded-2xl object-cover"
                />
              ) : null}
              <h1 className="text-2xl font-black text-slate-950">
                {title || "未命名草稿"}
              </h1>
              {selectedTopics.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedTopics.map((topic) => (
                    <span
                      key={topic}
                      className="rounded-full bg-[#fff3f5] px-3 py-1 text-xs font-semibold text-[#ff2442]"
                    >
                      #{normalizeTopicName(topic)}
                    </span>
                  ))}
                </div>
              ) : null}
              {selectedLocation ? (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  <MapPin size={14} />
                  {selectedLocation}
                </div>
              ) : null}
              <article className="mt-5 rounded-2xl bg-slate-50 p-5 text-base leading-8 text-slate-800">
                <RichTextRenderer
                  content={{
                    html: previewHtml || editorHtml(),
                    json: editorJsonContent,
                    text: editorText(),
                  }}
                />
              </article>
              {isBusy ? (
                <div className="mt-5 rounded-2xl bg-[#fff3f5] px-4 py-3 text-sm font-semibold text-[#ff2442]">
                  {statusMessage}
                </div>
              ) : null}
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowPreview(false)}
                  className="h-11 rounded-2xl bg-slate-100 px-6 text-sm font-bold text-slate-700"
                >
                  继续编辑
                </button>
                <button
                  type="button"
                  onClick={() => void submitForReview()}
                  disabled={isBusy}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#ff2442] px-6 text-sm font-bold text-white transition hover:bg-[#e91635] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isOperation("audit") ? "审核中..." : "内容审核"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function QualityRadarChart({ quality }: { quality: QualityScoreResult }) {
  const entries = (Object.entries(quality.dimensions) as Array<[
    keyof QualityScoreResult["dimensions"],
    number,
  ]>).slice(0, 5);
  const size = 200;
  const center = size / 2;
  const radius = size * 0.5;
  const maxDimensionScore = 20;

  const pointFor = (index: number, value: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / entries.length;
    const distance = radius * Math.max(0, Math.min(value, maxDimensionScore)) / maxDimensionScore;
    return {
      x: center + Math.cos(angle) * distance,
      y: center + Math.sin(angle) * distance,
    };
  };
  const axisPointFor = (index: number, distance = radius) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / entries.length;
    return {
      x: center + Math.cos(angle) * distance,
      y: center + Math.sin(angle) * distance,
    };
  };
  const polygon = entries.map(([, value], index) => pointFor(index, value)).map((point) => `${point.x},${point.y}`).join(" ");

  // 移除了外层的 bg-emerald-50/50 包装，使其背景透明，并轻微增加了 SVG 的溢出可见性防止截断
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto size-full max-w-52.5 overflow-visible">
      {[0.25, 0.5, 0.75, 1].map((scale) => (
        <polygon
          key={scale}
          points={entries.map((_, index) => {
            const point = axisPointFor(index, radius * scale);
            return `${point.x},${point.y}`;
          }).join(" ")}
          fill="none"
          stroke="rgba(16,185,129,0.18)"
        />
      ))}
      {entries.map(([key], index) => {
        const axis = axisPointFor(index);
        const label = axisPointFor(index, radius + 22); // 文字稍微收紧一点点
        return (
          <g key={key}>
            <line x1={center} y1={center} x2={axis.x} y2={axis.y} stroke="rgba(15,23,42,0.08)" />
            <text
              x={label.x}
              y={label.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-slate-500 text-sm font-semibold"
            >
              {qualityDimensionLabels[key]}
            </text>
          </g>
        );
      })}
      <polygon points={polygon} fill="rgba(16,185,129,0.28)" stroke="#10b981" strokeWidth="2" />
      {entries.map(([, value], index) => {
        const point = pointFor(index, value);
        return <circle key={index} cx={point.x} cy={point.y} r="3.5" fill="#10b981" />;
      })}
    </svg>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-[#ff2442]/50 focus:bg-white focus:ring-4 focus:ring-[#ff2442]/10" />
    </label>
  );
}

function AssistCard({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-left hover:border-[#ff2442]/20 hover:bg-[#fff3f5]">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">{desc}</p>
    </button>
  );
}

function AssetPanel({
  mode,
  assets,
  uploading,
  onClose,
  onUpload,
  onInsert,
  onDelete,
  onDragStart,
}: {
  mode: "image" | "text";
  assets: AssetSummary[];
  uploading: boolean;
  onClose: () => void;
  onUpload: () => void;
  onInsert: (asset: AssetSummary) => void;
  onDelete: (asset: AssetSummary) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, asset: AssetSummary) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-5xl rounded-3xl border border-slate-100 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold">{mode === "image" ? "图片素材库" : "文本素材库"}</h3>
            <p className="mt-1 text-sm text-slate-400">点击“插入正文”会放到当前光标处；也可以拖到正文指定位置。删除会从个人素材库移除。</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onUpload} className="inline-flex items-center gap-2 rounded-2xl bg-[#ff2442] px-4 py-2 text-sm font-semibold text-white">
              <UploadCloud size={16} />
              {uploading ? "上传中..." : "添加素材"}
            </button>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-50"><X size={16} /></button>
          </div>
        </div>
        <div className="grid max-h-[62vh] gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {assets.length ? assets.map((asset) => (
            <div key={asset.id} draggable onDragStart={(event) => onDragStart(event, asset)} className="rounded-2xl border border-slate-100 bg-white p-3 text-left shadow-sm hover:border-rose-100 hover:bg-[#fff3f5]">
              {mode === "image" ? (
                <div className="aspect-4/3 overflow-hidden rounded-xl bg-slate-100">
                  <img src={asset.url} alt={asset.fileName} className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="h-28 overflow-hidden rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
                  {textAssetPreview(asset)}
                </div>
              )}
              <p className="mt-3 truncate text-sm font-semibold text-slate-900">{asset.fileName}</p>
              <p className="mt-1 text-xs text-slate-400">{asset.mimeType} · {asset.auditStatus}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => onInsert(asset)} className="flex-1 rounded-xl bg-[#ff2442] px-3 py-2 text-xs font-semibold text-white">
                  插入正文
                </button>
                <button type="button" onClick={() => onDelete(asset)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-rose-50 hover:text-rose-600">
                  删除
                </button>
              </div>
            </div>
          )) : <div className="col-span-full grid h-52 place-items-center text-sm text-slate-400">暂无素材，点击右上角添加。</div>}
        </div>
      </div>
    </div>
  );
}
