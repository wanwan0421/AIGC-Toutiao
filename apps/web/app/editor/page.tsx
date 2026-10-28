"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ARTICLE_BODY_MAX_LENGTH,
  ARTICLE_TITLE_MAX_LENGTH,
  AiJobType,
  ContentStatus,
  countArticleCharacters,
  type AiJobEvent,
  type AiJobSnapshot,
  type AuditResult,
  type AuditRiskItem,
  type CreativeChatSkillEvent,
  type AssetSummary,
  type ComplianceReplacement,
  type ComplianceRewriteResult,
  type ContentApprovalResult,
  type ContentDetail,
  type ContentSummary,
  type ContentWorkflowState,
  type DirectGenerateResult,
  type GeneratedImageCandidate,
  type GeneratedImageAsset,
  type LocationCandidate,
  type OfficialTopicSummary,
  type QualityScoreResult,
  type SelectionRewriteResult,
  type TitleGenerateResult,
  type WritingStyleProfile,
  type WritingStyleSelection,
} from "@aicp/shared";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ApiError,
  attachCreativeConversation,
  buildWritingSkill,
  commitAiJobResult,
  confirmWritingSkill,
  createContent,
  deleteAsset,
  deleteContent,
  generateCreativeTitles,
  getAssets,
  getContentDetail,
  getContentWorkflowState,
  getContents,
  getCreativeConversations,
  getCreativeConversation,
  getCreativeImageConfigStatus,
  getDraft,
  getAiJob,
  getOfficialTopics,
  getEligibleWritingSkillContents,
  getWritingSkill,
  postNearbyLocations,
  publishContent,
  recoverAiJobs,
  rewriteSelection,
  searchLocations,
  startCreativeDraftJob,
  startCreativeImageJob,
  startAiJob,
  startQualityScoreJob,
  startSubmitReviewJob,
  updateContent,
  uploadAsset,
} from "../../lib/api";

const writingStyleFields: Array<[keyof WritingStyleProfile["common"], string]> = [
  ["structure", "文章结构"], ["opening", "开头方式"], ["transitions", "段落过渡"], ["ending", "结尾方式"],
  ["tone", "语气"], ["viewpoint", "叙述视角"], ["diction", "措辞习惯"],
];
import {
  clearStoredAiJobPendingCommit,
  listStoredAiJobs,
  setStoredAiJobPendingCommit,
} from "../../lib/ai-job-session";
import { useAiJob } from "../../lib/use-ai-job";
import { useDraftAutosave, type EditorDraftCache } from "./use-draft-autosave";
import { reconcileRestoredSelections, shouldRestoreLocalDraft } from "./draft-restore-validation";
import { useAuth } from "../../components/auth-provider";
import { CoverCropDialog } from "./cover-crop-dialog";
import { isAiJobInEditorScope } from "../../lib/editor-ai-job-scope";
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
  Plus,
  Search,
  ShieldCheck,
  Smile,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";

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

const RESTORABLE_EDITOR_JOB_TYPES = new Set<AiJobType>([
  AiJobType.CreativeChat,
  AiJobType.CreativeDirectGenerate,
  AiJobType.CreativeImageGenerate,
  AiJobType.ContentSubmitReview,
  AiJobType.ContentApprove,
]);

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  kind?: "chat" | "skill_status" | "skill_result";
  content: string;
  attachments?: string[];
  insertable?: boolean;
};

type GenerationStageView = {
  phase?: string;
  skillKey?: string;
  completedImages?: number;
  totalImages?: number;
};

const GENERATION_STAGE_LABELS: Record<string, string> = {
  requirements: "分析需求",
  article_draft: "写作正文",
  visual_plan: "规划配图",
  output_repair: "整理图文",
  image_generation: "生成图片",
};

function generationImageProgress(stage: GenerationStageView) {
  const total = Math.max(0, Number(stage.totalImages) || 0);
  if (!total) return stage.phase === "image_generation" ? "暂无配图" : "规划中";
  return `${Math.max(0, Number(stage.completedImages) || 0)}/${total}`;
}

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

function isRemovableRiskItem(item: AuditRiskItem) {
  const evidence = item.evidence.trim();
  if (!evidence || evidence === "全文") return false;
  if (item.startOffset !== undefined && item.endOffset !== undefined && item.endOffset <= item.startOffset) return false;
  return true;
}

function createRemovalReplacement(item: AuditRiskItem): ComplianceReplacement {
  return {
    riskItemId: item.id,
    original: item.evidence,
    replacement: "",
    reason: item.suggestion || "删除风险片段",
  };
}

const defaultIdeas = [
  "帮我把当前主题拆成 3 个可发布角度",
  "帮我补充一个更有冲突感的开头",
  "请为正文中的某个片段扩充生活化案例",
  "根据当前正文生成 5 个今日头条标题",
];

const emojiSuggestions = ["😊", "✨", "🔥", "👍", "💡", "📌", "🌿", "🎵"];
const contentStatements = ["无声明", "取材网络", "个人观点，仅供参考", "引用 AI", "健康医疗分享，仅供参考"];
const editableDraftStatuses = new Set<ContentStatus>([
  ContentStatus.Draft,
  ContentStatus.PendingReview,
  ContentStatus.Approved,
  ContentStatus.Scheduled,
  ContentStatus.Updated,
  ContentStatus.Rejected,
]);
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

function normalizeChatMarkdown(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const normalized: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const prev = normalized[normalized.length - 1]?.trim() ?? "";
    const next = lines[index + 1]?.trim() ?? "";
    if (!line.trim() && isMarkdownTableLine(prev) && isMarkdownTableLine(next)) {
      continue;
    }
    normalized.push(line);
  }
  return normalized.join("\n");
}

function isMarkdownTableLine(value: string) {
  return /^\|.*\|$/.test(value.trim());
}

function isMarkdownTableSeparator(value: string) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(value.trim());
}

function parseMarkdownTableRow(value: string) {
  return value
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function markdownToEditorHtml(markdown: string) {
  const normalizedMarkdown = normalizeChatMarkdown(markdown);
  if (!normalizedMarkdown.trim()) return "";
  const lines = normalizedMarkdown.split(/\r?\n/);
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
  const renderTable = (headers: string[], rows: string[][]) => {
    const head = headers.map((cell) => `<th>${inline(cell)}</th>`).join("");
    const body = rows
      .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
      .join("");
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const next = lines[index + 1]?.trim() ?? "";
    if (!trimmed) {
      flushList();
      continue;
    }
    if (isMarkdownTableLine(trimmed) && isMarkdownTableSeparator(next)) {
      flushList();
      const headers = parseMarkdownTableRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isMarkdownTableLine(lines[index].trim())) {
        rows.push(parseMarkdownTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      html.push(renderTable(headers, rows));
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

type GeneratedImagePlacement = {
  asset: GeneratedImageAsset;
  position?: string;
  prompt?: string;
  slotId?: string;
};

type GeneratedImageFallback = GeneratedImagePlacement & {
  fallbackReason: string;
};

function generatedImageFigureHtml(asset: GeneratedImageAsset) {
  return `<figure><img src="${asset.url}" alt="${escapeHtml(asset.fileName)}" /></figure>`;
}

function imageSlotPattern() {
  return /<!--\s*aicp-image-slot:([a-zA-Z0-9_-]+)\s*-->/g;
}

function stripImageSlotMarkers(markdown: string) {
  return markdown
    .replace(imageSlotPattern(), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 渲染生成的草稿，包含图片的插入位置和 HTML 输出
function renderGeneratedDraftWithImages(markdown: string, title: string, placements: GeneratedImagePlacement[]) {
  const bodyMarkdown = stripDuplicateTitleFromMarkdown(markdown, title);
  const slotMatches = Array.from(bodyMarkdown.matchAll(imageSlotPattern()));
  if (slotMatches.length) {
    const placementBySlot = new Map(
      placements
        .filter((placement) => placement.slotId || placement.asset.slotId)
        .map((placement) => [placement.slotId ?? placement.asset.slotId ?? "", placement]),
    );
    const placed: GeneratedImagePlacement[] = [];
    const usedAssetIds = new Set<string>();
    const html: string[] = [];
    let cursor = 0;

    for (const match of slotMatches) {
      const [marker, slotId] = match;
      const before = bodyMarkdown.slice(cursor, match.index);
      const cleanBefore = stripImageSlotMarkers(before);
      if (cleanBefore) html.push(markdownToEditorHtml(cleanBefore));

      const placement = placementBySlot.get(slotId);
      if (placement && !usedAssetIds.has(placement.asset.id)) {
        html.push(generatedImageFigureHtml(placement.asset));
        placed.push(placement);
        usedAssetIds.add(placement.asset.id);
      }
      cursor = (match.index ?? 0) + marker.length;
    }

    const rest = stripImageSlotMarkers(bodyMarkdown.slice(cursor));
    if (rest) html.push(markdownToEditorHtml(rest));

    const cleanBodyMarkdown = stripImageSlotMarkers(bodyMarkdown);
    return {
      bodyMarkdown: cleanBodyMarkdown,
      html: html.join("") || markdownToEditorHtml(cleanBodyMarkdown),
      placed,
      unplaced: placements
        .filter((placement) => !usedAssetIds.has(placement.asset.id))
        .map((placement) => ({
          ...placement,
          fallbackReason: placement.slotId || placement.asset.slotId
            ? `正文中没有匹配的图片槽位：${placement.slotId ?? placement.asset.slotId}`
            : "图片缺少槽位标识，未自动插入",
        })),
    };
  }

  const cleanMarkdown = stripImageSlotMarkers(bodyMarkdown);
  const blocks = cleanMarkdown.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length || !placements.length) {
    return {
      bodyMarkdown: cleanMarkdown,
      html: markdownToEditorHtml(cleanMarkdown),
      placed: [] as GeneratedImagePlacement[],
      unplaced: placements.map((placement) => ({
        ...placement,
        fallbackReason: blocks.length ? "未能识别正文插入位置" : "正文为空，无法自动插入",
      })),
    };
  }

  const inserts = new Map<number, GeneratedImagePlacement[]>();
  const placed: GeneratedImagePlacement[] = [];
  const unplaced: GeneratedImageFallback[] = [];

  placements.forEach((placement, index) => {
    const resolved = resolveImageInsertIndex(placement.position || placement.asset.position, blocks, index, placements.length);
    if (resolved.reason) {
      unplaced.push({ ...placement, fallbackReason: resolved.reason });
      return;
    }
    const insertIndex = Math.max(0, Math.min(blocks.length, resolved.index));
    inserts.set(insertIndex, [...(inserts.get(insertIndex) ?? []), placement]);
    placed.push(placement);
  });

  const html: string[] = [];
  const beforeFirst = inserts.get(0) ?? [];
  html.push(...beforeFirst.map((placement) => generatedImageFigureHtml(placement.asset)));
  for (let index = 0; index < blocks.length; index += 1) {
    html.push(markdownToEditorHtml(blocks[index]));
    const afterBlock = inserts.get(index + 1) ?? [];
    html.push(...afterBlock.map((placement) => generatedImageFigureHtml(placement.asset)));
  }

  return {
    bodyMarkdown: cleanMarkdown,
    html: html.join(""),
    placed,
    unplaced,
  };
}

function resolveImageInsertIndex(position: string | undefined, blocks: string[], ordinal: number, total: number) {
  const normalizedPosition = normalizeComparableText(position ?? "");
  const paragraphBlocks = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => isPlainParagraphBlock(block));
  const headingBlocks = blocks
    .map((block, index) => ({ heading: block.replace(/^#{1,6}\s+/, "").trim(), index }))
    .filter(({ heading }, index) => /^#{1,6}\s+/.test(blocks[index]) && heading);

  const paragraphMatch = (position ?? "").match(/第\s*([一二三四五六七八九十\d]+)\s*段后/);
  if (paragraphMatch) {
    const paragraphNumber = parsePositionNumber(paragraphMatch[1]);
    const target = paragraphNumber ? paragraphBlocks[paragraphNumber - 1] : undefined;
    return target ? { index: target.index + 1 } : { index: 0, reason: `正文没有第 ${paragraphNumber || paragraphMatch[1]} 段` };
  }

  const sectionNumberMatch = (position ?? "").match(/第\s*([一二三四五六七八九十\d]+)\s*(?:个)?(?:小节|章节|部分)后/);
  if (sectionNumberMatch) {
    const sectionNumber = parsePositionNumber(sectionNumberMatch[1]);
    const target = sectionNumber ? headingBlocks[sectionNumber - 1] : undefined;
    return target ? { index: Math.min(blocks.length, target.index + 2) } : { index: 0, reason: `正文没有第 ${sectionNumber || sectionNumberMatch[1]} 个小节` };
  }

  const headingTarget = headingBlocks.find(({ heading }) => {
    const normalizedHeading = normalizeComparableText(heading);
    return normalizedHeading && normalizedPosition.includes(normalizedHeading);
  });
  if (headingTarget) {
    return { index: Math.min(blocks.length, headingTarget.index + 2) };
  }

  if (/开头|首段/.test(position ?? "")) {
    const firstParagraph = paragraphBlocks[0];
    return firstParagraph ? { index: firstParagraph.index + 1 } : { index: 1 };
  }

  if (/结尾|末尾|文末/.test(position ?? "")) {
    return { index: blocks.length };
  }

  if (!position?.trim() || /正文中|中部|中间/.test(position)) {
    if (!paragraphBlocks.length) return { index: blocks.length };
    const targetOffset = Math.max(0, Math.min(paragraphBlocks.length - 1, Math.floor(((ordinal + 1) / (total + 1)) * paragraphBlocks.length)));
    return { index: paragraphBlocks[targetOffset].index + 1 };
  }

  return { index: 0, reason: `未能识别插入位置：${position}` };
}

function isPlainParagraphBlock(block: string) {
  const trimmed = block.trim();
  return Boolean(trimmed) && !/^#{1,6}\s+/.test(trimmed) && !/^[-*]\s+/.test(trimmed) && !isMarkdownTableLine(trimmed);
}

function parsePositionNumber(value: string) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (digits[value.slice(1)] ?? 0);
  if (value.endsWith("十")) return (digits[value.slice(0, -1)] ?? 0) * 10;
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (digits[tens] ?? 1) * 10 + (digits[ones] ?? 0);
  }
  return digits[value] ?? 0;
}

function normalizeComparableText(value: string) {
  return value
    .replace(/^#+\s*/, "")
    .replace(/[《》“”"'`*_#\s:：，。！？!?、-]/g, "")
    .toLowerCase();
}

function draftStorageKey(userId: string, contentId: string | null) {
  return `aicp:editor-draft:${userId}:${contentId ?? "new"}`;
}

function migrateOwnedLegacyDraft(userId: string, contentId: string): DraftCache | null {
  if (typeof window === "undefined") return null;
  const legacyKey = `aicp:editor-draft:${contentId}`;
  const raw = window.localStorage.getItem(legacyKey);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as DraftCache;
    if (draft.contentId !== contentId) return null;
    try {
      window.localStorage.setItem(draftStorageKey(userId, contentId), raw);
      window.localStorage.removeItem(legacyKey);
    } catch {
      // The already authorized draft can still be restored if local storage is full.
    }
    return draft;
  } catch {
    return null;
  }
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
  return asset.mimeType.startsWith("text/") || asset.mimeType === "application/markdown"
    || isGenerationDocument(asset);
}

function isGenerationDocument(asset: AssetSummary) {
  const mimeType = asset.mimeType.toLowerCase();
  if (/\.txt$/i.test(asset.fileName)) return mimeType === "text/plain";
  if (/\.(?:md|markdown)$/i.test(asset.fileName)) {
    return ["text/plain", "text/markdown", "text/x-markdown", "application/markdown"].includes(mimeType);
  }
  if (/\.pdf$/i.test(asset.fileName)) return mimeType === "application/pdf";
  if (/\.docx$/i.test(asset.fileName)) return mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return false;
}

function generationMaterialIds(items: AssetSummary[]) {
  return {
    attachmentAssetIds: items.filter(isImageAsset).map((item) => item.id),
    materialAssetIds: items.filter(isGenerationDocument).map((item) => item.id),
  };
}

function locationErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? `${fallback}：${error.message}` : fallback;
}

function assetIdFromUrl(assets: AssetSummary[], url?: string) {
  if (!url) return null;
  return assets.find((asset) => asset.url === url)?.id ?? null;
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
  [ContentStatus.Scheduled]: "定时发布",
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

function payloadWritingStyleMode(payload: Record<string, unknown>): "off" | "common" | "topic" {
  return payload.writingStyleMode === "common" || payload.writingStyleMode === "topic"
    ? payload.writingStyleMode
    : "off";
}

function payloadGeneratedImageCandidates(payload: Record<string, unknown>) {
  const value = payload.generatedImageCandidates;
  if (!Array.isArray(value)) return [];
  return value.map(toGeneratedImageCandidateFromPayload).filter((item): item is GeneratedImageCandidate => Boolean(item));
}

function toGeneratedImageCandidateFromPayload(value: unknown): GeneratedImageCandidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const asset = record.asset;
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) return null;
  const assetRecord = asset as Record<string, unknown>;
  const id = payloadCandidateString(assetRecord, "id");
  const fileName = payloadCandidateString(assetRecord, "fileName");
  const mimeType = payloadCandidateString(assetRecord, "mimeType");
  const url = payloadCandidateString(assetRecord, "url");
  if (!id || !fileName || !mimeType || !url) return null;

  return {
    asset: {
      id,
      fileName,
      mimeType,
      url,
      auditStatus: payloadCandidateString(assetRecord, "auditStatus") === "rejected" ? "rejected" : payloadCandidateString(assetRecord, "auditStatus") === "approved" ? "approved" : "pending",
      auditReason: payloadCandidateString(assetRecord, "auditReason") || undefined,
      riskLevel: normalizeRiskLevel(assetRecord.riskLevel),
      riskTypes: Array.isArray(assetRecord.riskTypes) ? assetRecord.riskTypes.filter((item): item is string => typeof item === "string") : undefined,
      createdAt: payloadCandidateString(assetRecord, "createdAt") || undefined,
      source: payloadCandidateString(assetRecord, "source") || undefined,
      metadata: assetRecord.metadata && typeof assetRecord.metadata === "object" && !Array.isArray(assetRecord.metadata)
        ? (assetRecord.metadata as Record<string, unknown>)
        : undefined,
      position: payloadCandidateString(assetRecord, "position") || "正文配图",
      prompt: payloadCandidateString(assetRecord, "prompt"),
      slotId: payloadCandidateString(assetRecord, "slotId") || undefined,
    },
    role: record.role === "cover" ? "cover" : "inline",
    operationId: payloadCandidateString(record, "operationId") || `generated-${id}`,
    inserted: false,
    position: payloadCandidateString(record, "position") || undefined,
    prompt: payloadCandidateString(record, "prompt") || undefined,
    slotId: payloadCandidateString(record, "slotId") || undefined,
    fallbackReason: payloadCandidateString(record, "fallbackReason") || undefined,
  };
}

function payloadCandidateString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function normalizeRiskLevel(value: unknown) {
  return value === "low" || value === "medium" || value === "high" || value === "unknown" ? value : undefined;
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
  // Match the server's rich-text plain-text form: two line breaks between
  // visible blocks, one per <br>. Repeated hard breaks must survive.
  const markers: string[] = [];
  for (let code = 0xe000; code <= 0xf8ff && markers.length < 2; code += 1) {
    const marker = String.fromCharCode(code);
    if (!html.includes(marker)) markers.push(marker);
  }
  if (markers.length !== 2) throw new Error("No available article separator markers");
  const [blockMarker, breakMarker] = markers;
  const withMarkers = html
    .replace(/<br\s*\/?\s*>/gi, breakMarker)
    .replace(/<\/(?:p|h[1-6]|blockquote|pre|li|tr|th|td|figcaption)>/gi, `$&${blockMarker}`);
  let text: string;
  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.innerHTML = withMarkers;
    container.querySelectorAll("script,style").forEach((node) => node.remove());
    text = container.textContent ?? "";
  } else {
    text = withMarkers.replace(/<[^>]*>/g, "");
  }
  const blocks = text.split(blockMarker);
  if (blocks.at(-1) === "") blocks.pop();
  return blocks.join("\n\n").replaceAll(breakMarker, "\n");
}

function titleForSave(title: string): string {
  return title.trim() ? title : "未命名草稿";
}

function articleLengthBlockReason(title: string, body: string): string | null {
  const titleCount = countArticleCharacters(title);
  const bodyCount = countArticleCharacters(body);
  const problems = [
    titleCount > ARTICLE_TITLE_MAX_LENGTH ? `标题 ${titleCount}/${ARTICLE_TITLE_MAX_LENGTH} 字` : null,
    bodyCount > ARTICLE_BODY_MAX_LENGTH ? `正文 ${bodyCount}/${ARTICLE_BODY_MAX_LENGTH} 字` : null,
  ].filter(Boolean);
  return problems.length ? `${problems.join("、")}，请缩短后保存` : null;
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
    coverAssetId: payloadString(payload, "coverAssetId") || assetIdFromUrl(detail.assets, detail.coverUrl),
    coverMode: payloadCoverMode(payload, fallbackCoverMode),
    assetIds: payloadStringArray(payload, "assetIds", detail.assets.map((item) => item.id)),
    briefTheme: payloadString(payload, "briefTheme"),
    materialNotes: payloadString(payload, "materialNotes"),
    briefMaterialIds: payloadStringArray(payload, "briefMaterialIds", []),
    chatMaterialIds: payloadStringArray(payload, "chatMaterialIds", []),
    referenceContentIds: payloadStringArray(payload, "referenceContentIds", []),
    writingStyleMode: payloadWritingStyleMode(payload),
    writingStyleVersionId: payloadString(payload, "writingStyleVersionId"),
    writingTopicKey: payloadString(payload, "writingTopicKey"),
    conversationId: payloadString(payload, "conversationId") || undefined,
    audience: payloadString(payload, "audience"),
    style: payloadString(payload, "style"),
    viewpoint: payloadString(payload, "viewpoint"),
    publishTimeMode: payloadPublishTimeMode(payload),
    scheduledAt: payloadString(payload, "scheduledAt"),
    selectedLocation: payloadString(payload, "selectedLocation"),
    visibility: payloadVisibility(payload),
    originalStatement: payloadBoolean(payload, "originalStatement", false),
    contentStatement: payloadString(payload, "contentStatement", "无声明"),
    generatedImageCandidates: payloadGeneratedImageCandidates(payload),
  };
}

export default function EditorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile: authProfile, status: authStatus } = useAuth();
  const { runJob, resumeJob, cancelJob, stopStreaming, isRunning: isAiJobRunning } = useAiJob();
  const editingContentId = searchParams.get("contentId");
  const editorRef = useRef<RichTextEditorHandle | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const generationInputRef = useRef<HTMLInputElement | null>(null);
  const generationUploadTargetRef = useRef<"brief" | "chat">("brief");
  const generationAttachedImageIdsRef = useRef(new Set<string>());
  const streamLockRef = useRef(false);
  const chatJobIdRef = useRef<string | null>(null);
  const editorReadyRef = useRef(false);
  const skipNextEditorInitRef = useRef<string | null>(null);
  const draggedAssetRef = useRef<AssetSummary | null>(null);
  const uploadIntentRef = useRef<UploadIntent>("library");
  const snapshotRef = useRef<() => DraftCache>(() => snapshot());
  const titleRef = useRef("");
  const bodyRef = useRef("");
  const persistedQualityInputRef = useRef<{ contentId: string; title: string; body: string } | null>(null);
  const reviewedAssetIdsRef = useRef<string[] | null>(null);
  const reviewedHtmlRef = useRef<string | null>(null);
  const reviewedTopicsRef = useRef<string[] | null>(null);
  const contentIdRef = useRef<string | null>(editingContentId);
  const coverAssetIdRef = useRef<string | null>(null);
  const coverPreviewRef = useRef("");
  const coverUserTouchedRef = useRef(false);
  const conversationIdRef = useRef<string | undefined>();
  const generatedImageCandidatesRef = useRef<GeneratedImageCandidate[]>([]);
  const publishRedirectTimerRef = useRef<number | null>(null);
  const restoredAiJobIdsRef = useRef(new Set<string>());
  const appliedRestoredAiJobIdsRef = useRef(new Set<string>());
  const editorInitializationOwnerRef = useRef(0);
  const restoredDraftEpochRef = useRef(0);
  const unverifiedCloudRecoveryRef = useRef<{ contentId: string; localSavedAt: string } | null>(null);

  const [contentId, setContentId] = useState<string | null>(editingContentId);
  const [editingStatus, setEditingStatus] = useState<ContentStatus | null>(
    null,
  );
  const [title, setTitle] = useState("");
  titleRef.current = title;
  const [body, setBody] = useState("");
  const [briefTheme, setBriefTheme] = useState("");
  const [audience, setAudience] = useState("");
  const [style, setStyle] = useState("");
  const [viewpoint, setViewpoint] = useState("");
  const [materialNotes, setMaterialNotes] = useState("");
  const [briefMaterials, setBriefMaterials] = useState<AssetSummary[]>([]);
  const [chatMaterials, setChatMaterials] = useState<AssetSummary[]>([]);
  const [referenceContentIds, setReferenceContentIds] = useState<string[]>([]);
  const [referenceChoices, setReferenceChoices] = useState<ContentSummary[]>([]);
  const [referencePickerTarget, setReferencePickerTarget] = useState<"brief" | "chat" | null>(null);
  const referencePickerRefs = useRef<{ brief: HTMLDivElement | null; chat: HTMLDivElement | null }>({ brief: null, chat: null });
  const [invalidReferenceIds, setInvalidReferenceIds] = useState<string[]>([]);
  const [invalidBriefMaterialIds, setInvalidBriefMaterialIds] = useState<string[]>([]);
  const [invalidChatMaterialIds, setInvalidChatMaterialIds] = useState<string[]>([]);
  const [invalidAttachmentLabels, setInvalidAttachmentLabels] = useState<string[]>([]);
  const [invalidCoverLabel, setInvalidCoverLabel] = useState<string | null>(null);
  const [invalidWritingStyleLabel, setInvalidWritingStyleLabel] = useState<string | null>(null);
  const [invalidConversationLabel, setInvalidConversationLabel] = useState<string | null>(null);
  const [writingSkill, setWritingSkill] = useState<any>(null);
  const [writingStyleMode, setWritingStyleMode] = useState<WritingStyleSelection["mode"]>("off");
  const [writingTopicKey, setWritingTopicKey] = useState("");
  const [writingStyleMenuOpen, setWritingStyleMenuOpen] = useState(false);
  const writingStyleMenuRef = useRef<HTMLDivElement | null>(null);
  const [writingStyleSetupOpen, setWritingStyleSetupOpen] = useState(false);
  const [writingStyleSetupBusy, setWritingStyleSetupBusy] = useState(false);
  const [writingStyleItems, setWritingStyleItems] = useState<any[]>([]);
  const [writingStylePage, setWritingStylePage] = useState(1);
  const [writingStyleTotal, setWritingStyleTotal] = useState(0);
  const [writingStyleSelectedIds, setWritingStyleSelectedIds] = useState<string[]>([]);
  const [writingStyleCandidate, setWritingStyleCandidate] = useState<WritingStyleProfile | null>(null);
  useEffect(() => {
    let current = true;
    void getWritingSkill().then((value) => { if (current) setWritingSkill(value); }).catch(() => undefined);
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (!writingStyleSetupOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWritingStyleSetupOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [writingStyleSetupOpen]);
  useEffect(() => {
    if (!writingStyleMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!writingStyleMenuRef.current?.contains(event.target as Node)) setWritingStyleMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWritingStyleMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [writingStyleMenuOpen]);
  useEffect(() => {
    if (!referencePickerTarget) return;
    const closeOutside = (event: MouseEvent) => {
      if (!referencePickerRefs.current[referencePickerTarget]?.contains(event.target as Node)) setReferencePickerTarget(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReferencePickerTarget(null);
    };
    document.addEventListener("mousedown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [referencePickerTarget]);
  const [generationMenuTarget, setGenerationMenuTarget] = useState<"brief" | "chat" | null>(null);
  const [prepTab, setPrepTab] = useState<PrepTab>("brief");
  const [chatInput, setChatInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatHistoryError, setChatHistoryError] = useState("");
  const [briefGenerationStage, setBriefGenerationStage] = useState<GenerationStageView | null>(null);
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [pendingCreativeCommitJobId, setPendingCreativeCommitJobId] = useState<string | null>(null);
  const [titleCandidates, setTitleCandidates] = useState<
    Array<{ title: string; reason: string }>
  >([]);
  const [showTitleCandidates, setShowTitleCandidates] = useState(false);
  const [statusMessage, setStatusMessage] = useState("编辑器已准备好");
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [activeOperation, setActiveOperation] = useState<EditorOperation | null>(null);
  const [restoringOperation, setRestoringOperation] = useState<EditorOperation | null>(null);
  const restoringOperationOwnerRef = useRef<string | null>(null);
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [hotTopics, setHotTopics] = useState<OfficialTopicSummary[]>([]);
  const [quickMenu, setQuickMenu] = useState<QuickMenu>(null);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState>(null);
  const [toneMenuOpen, setToneMenuOpen] = useState(false);
  const [customTone, setCustomTone] = useState("");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [customTopicInput, setCustomTopicInput] = useState("");
  const [coverPreview, setCoverPreview] = useState("");
  const [coverAssetId, setCoverAssetId] = useState<string | null>(null);
  const [coverMode, setCoverMode] = useState<CoverMode>("single");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [publishTimeMode, setPublishTimeMode] =
    useState<PublishTimeMode>("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [locationCandidates, setLocationCandidates] = useState<LocationCandidate[]>([]);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [processedRiskItemIds, setProcessedRiskItemIds] = useState<Set<string>>(new Set());
  const [contentStatementOpen, setContentStatementOpen] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [publishTimeOpen, setPublishTimeOpen] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [originalStatement, setOriginalStatement] = useState(false);
  const [contentStatement, setContentStatement] = useState("无声明");
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [assetPanel, setAssetPanel] = useState<null | "image" | "text" | "generation-brief" | "generation-chat">(null);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverCropFile, setCoverCropFile] = useState<File | null>(null);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [isUploadingGenerationMaterials, setIsUploadingGenerationMaterials] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [lastContentSummary, setLastContentSummary] = useState<ContentSummary | null>(null);
  const [workflowState, setWorkflowState] = useState<ContentWorkflowState | null>(null);
  const [reviewResult, setReviewResult] = useState<ReviewResultState>(null);
  const [reviewRewrite, setReviewRewrite] = useState<ReviewRewrite>(null);
  const [qualityResult, setQualityResult] = useState<QualityScoreResult | null>(null);
  const [generatedImageCandidates, setGeneratedImageCandidates] = useState<GeneratedImageCandidate[]>([]);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [imageConfig, setImageConfig] = useState<{
    configured: boolean;
    missing: string[];
  } | null>(null);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const busyOperation = activeOperation ?? restoringOperation;

  const imageAssets = useMemo(() => assets.filter(isImageAsset), [assets]);
  const textAssets = useMemo(() => assets.filter(isTextAsset), [assets]);
  const titleCount = useMemo(() => countArticleCharacters(title), [title]);
  const bodyCount = useMemo(() => countArticleCharacters(body), [body]);
  const titleTooLong = titleCount > ARTICLE_TITLE_MAX_LENGTH;
  const bodyTooLong = bodyCount > ARTICLE_BODY_MAX_LENGTH;
  const visibleReviewRiskItems = useMemo(
    () => (reviewResult?.audit.riskItems ?? []).filter((item) => item.severity !== "low" && !processedRiskItemIds.has(item.id)),
    [reviewResult, processedRiskItemIds],
  );
  const reviewReplacements = useMemo(() => reviewRewrite?.replacements ?? [], [reviewRewrite]);
  const reviewReplacementByRiskItem = useMemo(
    () => new Map(reviewReplacements.map((replacement) => [replacement.riskItemId, replacement])),
    [reviewReplacements],
  );
  const reviewRemovals = useMemo(
    () =>
      visibleReviewRiskItems
        .filter((item) => !reviewReplacementByRiskItem.has(item.id) && isRemovableRiskItem(item))
        .map(createRemovalReplacement),
    [visibleReviewRiskItems, reviewReplacementByRiskItem],
  );
  const reviewActions = useMemo(
    () => [...reviewReplacements, ...reviewRemovals],
    [reviewReplacements, reviewRemovals],
  );
  const reviewActionByRiskItem = useMemo(
    () => new Map(reviewActions.map((replacement) => [replacement.riskItemId, replacement])),
    [reviewActions],
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
    ContentStatus.Scheduled,
  ]);
  const persistedQualityInput = persistedQualityInputRef.current;
  const localQualityInputMatchesPersisted = Boolean(persistedQualityInput
    && persistedQualityInput.contentId === currentEditorContentId()
    && persistedQualityInput.title === titleForSave(title)
    && persistedQualityInput.body === editorText());
  const localReviewInputMatches = Boolean(
    localQualityInputMatchesPersisted
    && reviewResult?.content.id === currentEditorContentId()
    && reviewResult.content.updatedAt === lastContentSummary?.updatedAt
    && (reviewResult.content.coverUrl ?? "") === (coverMode === "none" ? "" : coverPreview)
    && reviewedHtmlRef.current !== null
    && reviewedHtmlRef.current === editorHtml()
    && reviewedTopicsRef.current?.join("\0") === normalizeTopicList(selectedTopics).join("\0")
    && reviewedAssetIdsRef.current
    && reviewedAssetIdsRef.current.join("\0") === buildContentAssetIds().sort().join("\0"),
  );
  const auditResultIsStale = Boolean(reviewResult?.audit.passed
    && (!localReviewInputMatches || (workflowState && !workflowState.currentAuditValid)));
  const auditPassedForCurrentContent = Boolean(reviewResult?.audit.passed && !auditResultIsStale);
  const displayStatusMessage = auditResultIsStale && statusMessage.startsWith("安全审核通过")
    ? "内容已修改，请重新进行内容审核"
    : statusMessage;
  const canRunQualityReview = Boolean(
    (workflowState?.canScoreQuality ?? Boolean(editingStatus && qualityReadyStatuses.has(editingStatus)))
    && localQualityInputMatchesPersisted && !auditResultIsStale,
  );
  const localCanPublishContent =
    editingStatus === ContentStatus.Approved ||
    editingStatus === ContentStatus.Updated ||
    editingStatus === ContentStatus.PendingReview ||
    editingStatus === ContentStatus.Scheduled;
  // Once the server has supplied workflow state, its audit/hash decision is
  // authoritative. Falling back to the local status here could show Publish
  // as enabled while quality review correctly remains blocked.
  const canPublishContent = (workflowState ? workflowState.canPublish : localCanPublishContent)
    && localQualityInputMatchesPersisted && !auditResultIsStale;
  const publishBlockReason = auditResultIsStale || (persistedQualityInput && !localQualityInputMatchesPersisted)
    ? "内容已修改，请保存并重新进行内容审核后再发布"
    : workflowState?.publishBlockReason ?? "内容需要先通过安全审核后才能发布";
  const qualityBlockMessage = (() => {
    if (auditResultIsStale || (persistedQualityInput && !localQualityInputMatchesPersisted)) {
      return "内容尚未保存，或安全审核已因内容修改失效；请保存并重新进行内容审核。";
    }
    switch (workflowState?.qualityBlockReason) {
      case "CONTENT_NOT_REVIEWED": return "请先对当前内容完成安全审核。";
      case "CONTENT_REJECTED": return "当前内容的安全审核未通过，请修改后重新审核。";
      case "CONTENT_CHANGED_AFTER_REVIEW": return "审核后内容或图片素材发生变化，请重新进行安全审核。";
      case "IMAGE_REVIEW_REQUIRED": return "当前作品中的图片尚未通过审核，请重新进行内容审核。";
      case "IMAGE_REVIEW_REJECTED": return "当前作品中的图片审核未通过，请更换图片后重新审核。";
      case "CONTENT_STATUS_NOT_SCORABLE": return "当前作品状态暂不支持质量评估。";
      default: return workflowState?.qualityBlockReason
        ? "当前内容暂不可进行质量评估，请重新审核后重试。"
        : "";
    }
  })();
  const [editorHtmlContent, setEditorHtmlContent] = useState(""); // 当 editorRef 还没挂载时，把 HTML 存在状态里
  const [editorJsonContent, setEditorJsonContent] = useState<Record<string, unknown> | null>(null);
  const [editorResetKey, setEditorResetKey] = useState(0);
  snapshotRef.current = snapshot;

  const {
    isOnline,
    isCloudSaving,
    localSaveError,
    scheduleLocalDraftSave,
    scheduleCloudAutosave,
    saveLocalDraftNow,
    readLocalDraft,
    removeLocalDraft,
    autoSaveDraft,
  } = useDraftAutosave({
    editorReadyRef,
    snapshotRef,
    draftStorageKey: (id) => draftStorageKey(authProfile?.id ?? "unauthenticated", id),
    ensureContentForDraft,
    isMeaningful: (data) => Boolean(
      data.title.trim() || data.body.trim() || editorRef.current?.getText().trim()
      || data.materialNotes?.trim() || data.briefMaterialIds?.length || data.chatMaterialIds?.length || data.referenceContentIds?.length
      || (data.writingStyleMode && data.writingStyleMode !== "off") || data.conversationId,
    ),
    shouldDeferCloudSave: () => streamLockRef.current || busyOperation !== null || isAiJobRunning || isChatStreaming || pendingCreativeCommitJobId !== null,
    cloudSyncBlockReason: (data) => articleLengthBlockReason(data.title, data.body),
    onStatus: setStatusMessage,
    onCloudSaved: loadDraftCards,
  });
  const isBusy = busyOperation !== null || isAiJobRunning || isChatStreaming || pendingCreativeCommitJobId !== null;
  const isOperation = (operation: EditorOperation) => busyOperation === operation;

  useEffect(() => {
    bodyRef.current = body;
  }, [body]);

  useEffect(() => {
    contentIdRef.current = contentId;
  }, [contentId]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  function rememberConversationId(nextId: string | undefined) {
    const changed = nextId !== conversationIdRef.current;
    conversationIdRef.current = nextId;
    setConversationId(nextId);
    if (nextId && changed) saveLocalDraftNow({ ...snapshotRef.current(), conversationId: nextId });
  }

  useEffect(() => {
    coverPreviewRef.current = coverPreview;
  }, [coverPreview]);

  useEffect(() => {
    generatedImageCandidatesRef.current = generatedImageCandidates;
  }, [generatedImageCandidates]);

  useEffect(() => {
    if (!generationMenuTarget) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const isInsideMenu = event.composedPath().some(
        (target) => target instanceof Element && target.hasAttribute("data-generation-file-menu"),
      );
      if (!isInsideMenu) {
        setGenerationMenuTarget(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGenerationMenuTarget(null);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [generationMenuTarget]);

  useEffect(() => {
    // Switching works detaches local subscriptions only. Durable jobs remain
    // active and are discoverable from the server when the user returns.
    // Creating a cloud ID for this same editor is not a work switch.
    if (editingContentId && skipNextEditorInitRef.current === editingContentId) {
      contentIdRef.current = editingContentId;
      setContentId(editingContentId);
      return;
    }
    stopStreaming();
    contentIdRef.current = editingContentId;
    setContentId(editingContentId);
    setLastContentSummary(null);
    setWorkflowState(null);
    setReviewResult(null);
    setChatHistoryError("");
    reviewedAssetIdsRef.current = null;
    reviewedHtmlRef.current = null;
    reviewedTopicsRef.current = null;
    setReviewRewrite(null);
    setQualityResult(null);
    setBriefMaterials([]);
    setChatMaterials([]);
    setGenerationMenuTarget(null);
    generationAttachedImageIdsRef.current.clear();
  }, [editingContentId, stopStreaming]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !authProfile?.id) return;
    const initializationOwner = editorInitializationOwnerRef.current + 1;
    editorInitializationOwnerRef.current = initializationOwner;
    if (editingContentId && skipNextEditorInitRef.current === editingContentId) {
      skipNextEditorInitRef.current = null;
      void loadDraftCards();
      void loadAssets();
      return;
    }

    void initializeEditor(editingContentId, initializationOwner);
    void loadDraftCards();
    void loadAssets();
    void loadTopics();
    void loadImageConfig();
  }, [editingContentId, authProfile?.id, authStatus]);

  // 恢复 AI 任务状态：先尝试本地缓存，再尝试从服务器恢复。恢复成功后，继续监听任务进度。
  useEffect(() => {
    // 正常用户操作和刷新恢复分别持有状态。恢复流程只观察正常操作
    if (isLoadingInitial || activeOperation !== null) return;
    let disposed = false;
    let restoreOwnerId: string | null = null;
    const expectedContentId = contentIdRef.current ?? editingContentId;
    void (async () => {
      const local = listStoredAiJobs().find(
        (item) => RESTORABLE_EDITOR_JOB_TYPES.has(item.type) && (expectedContentId ? item.contentId === expectedContentId : !item.contentId)
      );
      const recoveryScope = conversationIdRef.current
        ? { conversationId: conversationIdRef.current, limit: 20 }
        : expectedContentId ? { contentId: expectedContentId, limit: 20 } : null;
      const serverJobs = !local && recoveryScope ? await recoverAiJobs(recoveryScope).catch(() => []) : [];
      const restorableServerJobs = serverJobs.filter((item) => RESTORABLE_EDITOR_JOB_TYPES.has(item.type));
      // 服务端自动恢复只接管非终态任务。终态任务只有在当前标签页仍保留
      // sessionStorage 指针时才恢复一次，避免每次刷新都重放最近的已完成任务。
      const server = restorableServerJobs.find((item) => !["succeeded", "failed", "cancelled"].includes(item.status));
      const candidate = local ? { id: local.jobId, type: local.type } : server ? { id: server.id, type: server.type } : undefined;
      if (!candidate || disposed || restoredAiJobIdsRef.current.has(candidate.id)) return;
      restoredAiJobIdsRef.current.add(candidate.id);

      // 恢复 AI 任务时，先把编辑器状态切换到对应的操作模式，避免用户在恢复过程中修改正文导致恢复失败。
      if (candidate.type === AiJobType.CreativeChat) {
        setIsChatStreaming(true);
        chatJobIdRef.current = candidate.id;
        await resumeJob(candidate.id, {
          onSnapshot: (snapshot) => { if (!disposed) chatJobIdRef.current = snapshot.id; },
          onPartial: (data) => {
            if (disposed) return;
            if (data.kind !== "creativeChatEvent" || !data.value || typeof data.value !== "object") return;
            const event = data.value as { type?: string; data?: Record<string, unknown> };
            if (event.type === "meta" && typeof event.data?.conversationId === "string") {
              rememberConversationId(event.data.conversationId);
              setChatHistoryError("");
            }
            if (event.type !== "delta") return;
            const delta = typeof event.data?.text === "string" ? event.data.text : "";
            setChatMessages((items) => {
              const id = `restored-${candidate.id}`;
              const existing = items.find((item) => item.id === id);
              return existing
                ? items.map((item) => item.id === id ? { ...item, content: `${item.content}${delta}` } : item)
                : [...items, { id, role: "assistant", kind: "chat", content: delta }];
            });
          },
          onDone: async (finishedJob, result) => {
            if (disposed) return;
            const finishedConversationId = (result as { conversationId?: string } | null)?.conversationId
              ?? finishedJob.conversationId ?? conversationIdRef.current;
            if (expectedContentId || finishedConversationId) {
              try {
                const conversations = await loadRestorableConversations(expectedContentId, finishedConversationId);
                const latest = conversations[0];
                if (latest && !disposed) {
                  rememberConversationId(latest.id);
                  setChatMessages(latest.messages.map((item, index) => ({ id: item.id ?? `${latest.id}-${index}`, role: item.role, kind: "chat", content: item.content })));
                  setInvalidConversationLabel(null);
                  setChatHistoryError("");
                }
              } catch {
                if (!disposed) setChatHistoryError("聊天记录暂时无法加载，请重试");
              }
            }
            if (disposed || !finishedConversationId || !finishedJob.assistantMessageId) return;
            const relatedJobs = await recoverAiJobs({ conversationId: finishedConversationId, limit: 20 }).catch(() => []);
            const childJob = relatedJobs.find((item) => item.type === AiJobType.CreativeDirectGenerate
              && item.assistantMessageId === finishedJob.assistantMessageId);
            if (childJob && !disposed) {
              chatJobIdRef.current = childJob.id;
              await runConversationDraftJob({ type: "job_started", skillKey: "content-production-line", job: childJob }, finishedJob.assistantMessageId);
            }
          },
          onError: (message) => { if (!disposed) setStatusMessage(message); },
        });
        if (!disposed) {
          chatJobIdRef.current = null;
          setIsChatStreaming(false);
        }
        return;
      }

      const restoredMetadata = candidate.type === AiJobType.CreativeDirectGenerate
        ? await getAiJob(candidate.id).catch(() => null)
        : null;
      const restoredAssistantId = restoredMetadata?.assistantMessageId ?? undefined;
      restoreOwnerId = crypto.randomUUID();
      restoringOperationOwnerRef.current = restoreOwnerId;
      setRestoringOperation(editorOperationForJobType(candidate.type));
      setStatusMessage("检测到 AI 任务，正在从服务器恢复状态...");
      const restoredJob = await resumeJob(candidate.id, {
        onProgress: (data) => { if (!disposed && typeof data.message === "string") setStatusMessage(data.message); },
        onPartial: (data) => {
          if (disposed || candidate.type !== AiJobType.CreativeDirectGenerate || data.kind !== "generationStage") return;
          if (restoredAssistantId) setAssistantGenerationStage(restoredAssistantId, data.value);
          else if (data.value && typeof data.value === "object") setBriefGenerationStage(data.value as GenerationStageView);
        },
        onWarning: (message) => { if (!disposed) setStatusMessage(message); },
        onResultReady: (restoredJob, result, event) => disposed ? undefined : commitCreativeJobResult(restoredJob, result, event),
        onDone: async (restoredJob, result) => {
          if (disposed) return;
          await handleEditorJobDone(restoredJob, result);
          setPendingCreativeCommitJobId(null);
          setBriefGenerationStage(null);
          if (restoredJob.type === AiJobType.CreativeDirectGenerate && restoredJob.contentId && restoredJob.conversationId) {
            try {
              const conversations = await loadRestorableConversations(restoredJob.contentId, restoredJob.conversationId);
              const latest = conversations[0];
              if (latest && !disposed) {
                rememberConversationId(latest.id);
                setChatMessages(latest.messages.map((item, index) => ({ id: item.id ?? `${latest.id}-${index}`, role: item.role, kind: "chat", content: item.content, insertable: false })));
                setInvalidConversationLabel(null);
                setChatHistoryError("");
              }
            } catch {
              if (!disposed) setChatHistoryError("聊天记录暂时无法加载，请重试");
            }
          }
        },
        onError: (message, failedJob) => {
          if (disposed) return;
          setBriefGenerationStage(null);
          if (failedJob?.status === "awaiting_commit") {
            setPendingCreativeCommitJobId(failedJob.id);
            setStatusMessage(`图文已生成，但保存失败：${message}`);
            if (restoredAssistantId) setAssistantSkillStatus(restoredAssistantId, `图文已生成，但保存失败：${message}。请点击“继续保存图文”。`);
            return;
          }
          setStatusMessage(`AI 任务恢复失败：${message}`);
          if (restoredAssistantId && candidate.type === AiJobType.CreativeDirectGenerate && (failedJob?.status === "failed" || failedJob?.status === "cancelled")) {
            setAssistantFinalReply(restoredAssistantId, failedJob.status === "cancelled" ? "图文生成已取消。" : `图文生成失败：${message}`);
          }
        },
      });
      if (!disposed && restoredJob.status === "awaiting_commit") setPendingCreativeCommitJobId(restoredJob.id);
    })().catch((error) => {
      if (!disposed) setStatusMessage(error instanceof Error ? `AI 任务恢复失败：${error.message}` : "AI 任务恢复失败");
    }).finally(() => {
      // 资源释放不受 disposed 限制；owner 校验可防止旧恢复流程解锁新任务。
      if (restoreOwnerId && restoringOperationOwnerRef.current === restoreOwnerId) {
        restoringOperationOwnerRef.current = null;
        setRestoringOperation(null);
      }
    });
    return () => {
      disposed = true;
      if (restoreOwnerId && restoringOperationOwnerRef.current === restoreOwnerId) {
        restoringOperationOwnerRef.current = null;
        setRestoringOperation(null);
      }
    };
  }, [activeOperation, editingContentId, isLoadingInitial, resumeJob]);

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
    coverAssetId,
    coverMode,
    coverPreview,
    editorHtmlContent,
    editorJsonContent,
    originalStatement,
    publishTimeMode,
    scheduledAt,
    selectedLocation,
    selectedTopics,
    conversationId,
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
    return editorRef.current?.getHTML() ? editorRef.current.getText() : bodyRef.current;
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

  function rememberCoverAssetId(id: string | null) {
    coverAssetIdRef.current = id;
    setCoverAssetId(id);
  }

  function setCoverFromAsset(asset: AssetSummary, options: { auto?: boolean } = {}) {
    if (!options.auto) coverUserTouchedRef.current = true;
    rememberCoverAssetId(asset.id);
    coverPreviewRef.current = asset.url;
    setCoverPreview(asset.url);
    setCoverMode("single");
  }

  function clearCover(options: { auto?: boolean } = {}) {
    if (!options.auto) coverUserTouchedRef.current = true;
    rememberCoverAssetId(null);
    coverPreviewRef.current = "";
    setCoverPreview("");
  }

  function resolveCoverAssetId(
    sourceIds = assetIds,
    sourceCoverAssetId: string | null | undefined = coverAssetIdRef.current,
    sourceCoverPreview = coverPreview,
    sourceCoverMode = coverMode,
  ) {
    if (sourceCoverMode === "none") return null;
    if (sourceCoverAssetId) return sourceCoverAssetId;
    return assetIdFromUrl(assets, sourceCoverPreview) ?? sourceIds.find((id) => id === assetIdFromUrl(assets, sourceCoverPreview)) ?? null;
  }

  function buildContentAssetIds(
    sourceIds = assetIds,
    sourceCoverAssetId: string | null | undefined = coverAssetIdRef.current,
    sourceCoverPreview = coverPreview,
    sourceCoverMode = coverMode,
  ) {
    return Array.from(
      new Set(
        [
          resolveCoverAssetId(sourceIds, sourceCoverAssetId, sourceCoverPreview, sourceCoverMode),
          ...sourceIds,
        ].filter((id): id is string => Boolean(id)),
      ),
    );
  }

  function rememberGeneratedImageCandidates(
    next:
      | GeneratedImageCandidate[]
      | ((items: GeneratedImageCandidate[]) => GeneratedImageCandidate[]),
  ) {
    const value = typeof next === "function" ? next(generatedImageCandidatesRef.current) : next;
    generatedImageCandidatesRef.current = value;
    setGeneratedImageCandidates(value);
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
      materialNotes,
      selectedTopics,
      coverPreview,
      coverAssetId: resolveCoverAssetId(),
      coverMode,
      assetIds: buildContentAssetIds(),
      briefMaterialIds: briefMaterials.map((asset) => asset.id),
      chatMaterialIds: chatMaterials.map((asset) => asset.id),
      referenceContentIds,
      writingStyleMode,
      writingStyleVersionId: writingStyleMode === "off" ? "" : writingSkill?.activeVersion?.id ?? "",
      writingTopicKey,
      conversationId: conversationIdRef.current,
      publishTimeMode,
      scheduledAt,
      selectedLocation,
      visibility,
      originalStatement,
      contentStatement,
      generatedImageCandidates: generatedImageCandidatesRef.current,
    };
  }

  // 草稿恢复的总出口，负责将数据赋回 React 各个散装的状态里
  async function loadRestorableConversations(
    targetContentId: string | null | undefined,
    requestedConversationId?: string,
    knownConversations?: Awaited<ReturnType<typeof getCreativeConversations>>,
  ) {
    let conversations = knownConversations ?? [];
    let listError: unknown;
    if (!knownConversations && targetContentId) {
      try {
        conversations = await getCreativeConversations(targetContentId);
      } catch (error) {
        listError = error;
      }
    }
    if (requestedConversationId && !conversations.some((item) => item.id === requestedConversationId)) {
      try {
        const conversation = await getCreativeConversation(requestedConversationId);
        if (targetContentId && !conversation.contentId) {
          const attached = await attachCreativeConversation(conversation.id, targetContentId);
          return [await getCreativeConversation(attached.conversationId)];
        }
        if (!targetContentId || conversation.contentId === targetContentId) return [conversation];
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    }
    if (conversations.length) return conversations;
    if (listError) throw listError;
    return conversations;
  }

  async function refreshChatHistory() {
    const targetContentId = currentEditorContentId();
    const requestedConversationId = conversationIdRef.current;
    if (!targetContentId && !requestedConversationId) return;
    try {
      const conversations = await loadRestorableConversations(targetContentId, requestedConversationId);
      if (targetContentId !== currentEditorContentId() || requestedConversationId !== conversationIdRef.current) return;
      const latest = conversations[0];
      if (!latest) {
        setChatHistoryError("未找到这篇作品的聊天记录");
        return;
      }
      rememberConversationId(latest.id);
      setChatMessages(latest.messages.map((item, index) => ({
        id: item.id ?? `${latest.id}-${index}`, role: item.role, kind: "chat", content: item.content, insertable: false,
      })));
      setInvalidConversationLabel(null);
      setChatHistoryError("");
    } catch {
      setChatHistoryError("聊天记录暂时无法加载，请重试");
    }
  }

  async function applySnapshot(data: EditorSnapshotInput, knownConversations?: Awaited<ReturnType<typeof getCreativeConversations>>, requireValidation = false) {
    const restoreEpoch = ++restoredDraftEpochRef.current;
    const nextBody = data.body ?? "";
    const nextHtml = resolveEditorHtml(
      nextBody,
      data.html,
      data.assetPreviews ?? [],
    );
    const persistedQualityInput = persistedQualityInputRef.current;
    if (persistedQualityInput && (
      persistedQualityInput.contentId !== (data.contentId ?? "")
      || persistedQualityInput.title !== titleForSave(data.title ?? "")
      || persistedQualityInput.body !== nextBody
    )) setQualityResult(null);
    setContentId(data.contentId ?? null);
    setTitle(data.title ?? "");
    titleRef.current = data.title ?? "";
    setBody(nextBody);
    setBriefTheme(data.briefTheme ?? "");
    setAudience(data.audience ?? "");
    setStyle(data.style ?? "");
    setViewpoint(data.viewpoint ?? "");
    setMaterialNotes(data.materialNotes ?? "");
    setWritingStyleMode("off");
    setWritingTopicKey(data.writingTopicKey ?? "");
    rememberConversationId(undefined);
    setBriefMaterials([]);
    setChatMaterials([]);
    setReferenceContentIds([]);
    setAssetIds([]);
    setInvalidBriefMaterialIds([]);
    setInvalidChatMaterialIds([]);
    setInvalidReferenceIds([]);
    setInvalidAttachmentLabels([]);
    setInvalidCoverLabel(null);
    setInvalidWritingStyleLabel(null);
    setInvalidConversationLabel(null);
    setSelectedTopics(normalizeTopicList(data.selectedTopics ?? []));
    coverUserTouchedRef.current = false;
    coverPreviewRef.current = "";
    setCoverPreview("");
    rememberCoverAssetId(null);
    setCoverMode(data.coverMode ?? "single");
    setPublishTimeMode(data.publishTimeMode ?? "now");
    setScheduledAt(data.scheduledAt ?? "");
    setSelectedLocation(data.selectedLocation ?? "");
    setVisibility(data.visibility ?? "public");
    setOriginalStatement(data.originalStatement ?? false);
    setContentStatement(data.contentStatement ?? "无声明");
    rememberGeneratedImageCandidates(data.generatedImageCandidates ?? []);
    writeEditorContent({ html: nextHtml, json: data.json ?? null, text: nextBody });
    const savedReferenceIds = [...new Set((data.referenceContentIds ?? []).filter((id): id is string => typeof id === "string" && Boolean(id.trim())))];
    const [assetsResult, contentsResult, styleResult, conversationsResult, referenceDetailsResult] = await Promise.allSettled([
      getAssets(),
      getContents(),
      getWritingSkill(),
      loadRestorableConversations(data.contentId, data.conversationId, knownConversations),
      Promise.allSettled(savedReferenceIds.map((id) => getContentDetail(id))),
    ]);
    if (restoreEpoch !== restoredDraftEpochRef.current) return;
    const assetSelectionSaved = Boolean(data.assetIds?.length || data.coverAssetId || data.coverPreview || data.briefMaterialIds?.length || data.chatMaterialIds?.length);
    const referenceDetails = referenceDetailsResult.status === "fulfilled" ? referenceDetailsResult.value : [];
    const referenceCheckFailed = referenceDetailsResult.status === "rejected" || referenceDetails.some((result) =>
      result.status === "rejected" && !(result.reason instanceof ApiError && [403, 404].includes(result.reason.status)));
    const requiredCheckFailed = (assetSelectionSaved && assetsResult.status === "rejected")
      || (savedReferenceIds.length > 0 && referenceCheckFailed)
      || (Boolean(data.writingStyleMode && data.writingStyleMode !== "off") && styleResult.status === "rejected");
    if (requireValidation && requiredCheckFailed) {
      throw new Error("草稿中的素材或写作选项暂无法核验，请联网后重新打开草稿");
    }
    const currentAssets = assetsResult.status === "fulfilled" ? assetsResult.value : [];
    const currentContents = contentsResult.status === "fulfilled" ? contentsResult.value : [];
    const verifiedReferences = referenceDetails.flatMap((result) => result.status === "fulfilled"
      && result.value.status === "published" && countArticleCharacters(result.value.body) <= ARTICLE_BODY_MAX_LENGTH
      ? [result.value] : []);
    const currentStyle = styleResult.status === "fulfilled" ? styleResult.value : null;
    const currentConversations = conversationsResult.status === "fulfilled" ? conversationsResult.value : [];
    const restored = reconcileRestoredSelections(data, currentAssets, verifiedReferences, currentStyle, currentConversations);
    setAssets(currentAssets);
    setReferenceChoices([...new Map([...currentContents, ...verifiedReferences]
      .filter((item) => item.status === "published").map((item) => [item.id, item])).values()]);
    setBriefMaterials(restored.brief.selected);
    setChatMaterials(restored.chat.selected);
    setInvalidBriefMaterialIds(restored.brief.invalid);
    setInvalidChatMaterialIds(restored.chat.invalid);
    setReferenceContentIds(restored.validReferenceIds);
    setInvalidReferenceIds(restored.invalidReferenceIds);
    setAssetIds(restored.attachmentIds);
    const assetById = new Map(currentAssets.map((asset) => [asset.id, asset]));
    const validCandidates: GeneratedImageCandidate[] = [];
    const invalidCandidates: string[] = [];
    for (const candidate of data.generatedImageCandidates ?? []) {
      const currentAsset = assetById.get(candidate.asset.id);
      if (currentAsset && isImageAsset(currentAsset) && currentAsset.auditStatus !== "rejected") {
        validCandidates.push({ ...candidate, asset: { ...candidate.asset, ...currentAsset } });
      } else invalidCandidates.push(candidate.asset.fileName);
    }
    rememberGeneratedImageCandidates(validCandidates);
    setInvalidAttachmentLabels([...new Set([...restored.invalidAttachmentIds, ...invalidCandidates])]);
    setInvalidCoverLabel(restored.invalidCover);
    setInvalidWritingStyleLabel(restored.invalidWritingStyle);
    setInvalidConversationLabel(conversationsResult.status === "rejected" ? null : restored.invalidConversation);
    setChatHistoryError(conversationsResult.status === "rejected" ? "聊天记录暂时无法加载，请重试" : "");
    generationAttachedImageIdsRef.current = new Set([...restored.brief.selected, ...restored.chat.selected]
      .filter(isImageAsset).map((asset) => asset.id));
    rememberCoverAssetId(restored.cover?.id ?? null);
    coverPreviewRef.current = restored.cover?.url ?? "";
    setCoverPreview(restored.cover?.url ?? "");
    setWritingSkill(currentStyle);
    setWritingStyleMode(restored.writingStyleMode);
    setWritingTopicKey(restored.writingStyleMode === "topic" ? data.writingTopicKey ?? "" : "");
    rememberConversationId(restored.conversation?.id ?? (conversationsResult.status === "rejected" ? data.conversationId : undefined));
    setChatMessages(restored.conversation?.messages.map((item, index) => ({
      id: item.id ?? `${restored.conversation?.id}-${index}`,
      role: item.role,
      kind: "chat" as const,
      content: item.content,
      insertable: false,
    })) ?? []);
    if ([assetsResult, contentsResult, styleResult, conversationsResult].some((result) => result.status === "rejected")) {
      setStatusMessage("部分草稿选项暂无法验证，请联网后重新打开草稿");
    }
  }

  function writeEditorContent(content: RichTextInitialContent) {
    const html = content.html ?? "";
    const json = (content.json && typeof content.json === "object" ? content.json : null) as Record<string, unknown> | null;
    const nextText = content.text ?? textFromHtml(html);
    setEditorResetKey((value) => value + 1);
    editorRef.current?.setContent(content);
    const editorValue = editorRef.current?.getValue();
    const parsed = editorValue?.html ? editorValue : null;
    setEditorHtmlContent(parsed?.html ?? html);
    setEditorJsonContent((parsed?.json as Record<string, unknown> | undefined) ?? json);
    bodyRef.current = parsed?.text ?? nextText;
    setBody(bodyRef.current);
    return parsed?.html ?? html;
  }

  function writeEditorMarkup(html: string, nextBody?: string) {
    writeEditorContent({ html, json: null, text: nextBody ?? textFromHtml(html) });
  }

  function openDraftCard(draftId: string) {
    if (editingContentId === draftId) return;
    router.push(`/studio/editor?contentId=${draftId}`, { scroll: false });
  }

  // 首次进入空白编辑页
  async function initializeEditor(targetContentId: string | null, initializationOwner: number) {
    editorReadyRef.current = false;
    unverifiedCloudRecoveryRef.current = null;
    setIsLoadingInitial(true);
    let initialized = false;
    const isCurrentInitialization = () => editorInitializationOwnerRef.current === initializationOwner;
    try {
      if (targetContentId) {
        // 先从后端数据库里面获取数据，避免本地草稿数据过旧导致用户丢失修改内容
        const detail = await getContentDetail(targetContentId);
        if (!isCurrentInitialization()) return;
        setEditingStatus(detail.status);
        setLastContentSummary(detail);
        setTitle(detail.title);
        titleRef.current = detail.title;
        persistedQualityInputRef.current = { contentId: detail.id, title: detail.title, body: detail.body };
        reviewedAssetIdsRef.current = detail.assets.map((item) => item.id).sort();
        setSelectedTopics(normalizeTopicList(detail.tags));
        setAssetIds(detail.assets.map((item) => item.id));
        coverUserTouchedRef.current = false;
        coverPreviewRef.current = detail.coverUrl ?? "";
        setCoverPreview(detail.coverUrl ?? "");
        rememberCoverAssetId(assetIdFromUrl(detail.assets, detail.coverUrl));
        setCoverMode(detail.coverUrl ? "single" : "none");
        reviewedHtmlRef.current = writeEditorContent({
          html: detail.bodyHtml || contentToEditorHtml(detail.body, detail.assets),
          json: detail.bodyJson ?? null,
          text: detail.body,
        });
        reviewedTopicsRef.current = normalizeTopicList(detail.tags);

        // 再获取草稿数据
        const [draftResult, conversationsResult, state] = await Promise.all([
          getDraft(detail.id).then((draft) => ({ draft, error: null as unknown })).catch((error: unknown) => ({ draft: null, error })),
          getCreativeConversations(detail.id).then((items) => ({ items, error: null as unknown }))
            .catch((error: unknown) => ({ items: [], error })),
          getContentWorkflowState(detail.id).catch(() => null),
        ]);
        if (!isCurrentInitialization()) return;
        const conversations = conversationsResult.items;
        if (state) applyWorkflowState(state);

        // 如果草稿存在，比较草稿和服务器内容的时间戳，优先恢复较新的内容，避免用户在编辑过程中丢失修改内容
        const { draft, error: draftError } = draftResult;
        const local = readLocalDraft(targetContentId) ?? migrateOwnedLegacyDraft(authProfile!.id, targetContentId);
        const scopedLocal = local?.contentId === targetContentId ? local : null;
        if (local && !scopedLocal) removeLocalDraft(targetContentId);
        if (scopedLocal && shouldRestoreLocalDraft(scopedLocal.savedAt, draft, Boolean(draftError))) {
          await applySnapshot(scopedLocal, conversationsResult.error ? undefined : conversations, true);
          if (draftError) unverifiedCloudRecoveryRef.current = { contentId: targetContentId, localSavedAt: scopedLocal.savedAt };
          setStatusMessage(draftError ? "云端草稿暂不可读取，已恢复本地草稿" : "已恢复本地离线草稿");
        } else if (draft) {
          await applySnapshot(snapshotFromCloudDraft(draft, detail), conversationsResult.error ? undefined : conversations, true);
          setStatusMessage("已恢复云端草稿");
        } else if (draftError) {
          throw draftError;
        }
        if (!isCurrentInitialization()) return;
        if (!draft && !scopedLocal) {
          const latestConversation = conversations[0];
          rememberConversationId(latestConversation?.id);
          setChatMessages(latestConversation?.messages.map((item) => ({
            id: item.id ?? `${item.role}-${item.createdAt}`,
            role: item.role,
            kind: "chat",
            content: item.content,
            insertable: false,
          })) ?? []);
          setChatHistoryError(conversationsResult.error ? "聊天记录暂时无法加载，请重试" : "");
        }
        await loadAssets();
      } else {
        resetEditorForNewContent();
        // 尝试读取无ID的本地草稿，恢复用户上次进入编辑页时的编辑状态，避免用户在编辑过程中丢失修改内容
        const local = readLocalDraft(null);

        // 如果存在缓存，映射到编辑器状态，恢复编辑内容和选项设置，并提示用户已恢复未发布的草稿
        if (local) {
          await applySnapshot(local, undefined, true);
          setStatusMessage("已恢复本地未发布草稿");
        }
      }
      initialized = true;
    } catch (error) {
      if (!isCurrentInitialization()) return;
      resetEditorForNewContent();
      contentIdRef.current = targetContentId;
      setContentId(targetContentId);
      setStatusMessage(error instanceof Error ? `加载文章失败：${error.message}` : "加载文章失败");
    } finally {
      if (isCurrentInitialization()) {
        // Keep autosave disabled after a failed load so stale editor state cannot target a missing content row.
        editorReadyRef.current = initialized;
        setIsLoadingInitial(false);
      }
    }
  }

  // 打开新内容编辑页时重置所有状态，确保不会有旧内容残留，避免用户误操作导致内容混乱
  function resetEditorForNewContent() {
    restoredDraftEpochRef.current += 1;
    setEditingStatus(null);
    setTitle("");
    titleRef.current = "";
    setBody("");
    setBriefTheme("");
    setAudience("");
    setStyle("");
    setViewpoint("");
    setMaterialNotes("");
    setBriefMaterials([]);
    setChatMaterials([]);
    setInvalidBriefMaterialIds([]);
    setInvalidChatMaterialIds([]);
    setInvalidAttachmentLabels([]);
    setInvalidCoverLabel(null);
    setInvalidWritingStyleLabel(null);
    setInvalidConversationLabel(null);
    setChatHistoryError("");
    setReferenceContentIds([]);
    setInvalidReferenceIds([]);
    setReferencePickerTarget(null);
    setWritingStyleMode("off");
    setWritingTopicKey("");
    setSelectedTopics([]);
    setAssetIds([]);
    clearCover();
    setCoverMode("single");
    rememberConversationId(undefined);
    setChatMessages([]);
    setBriefGenerationStage(null);
    setShowPreview(false);
    setPreviewHtml("");
    setLastContentSummary(null);
    persistedQualityInputRef.current = null;
    reviewedAssetIdsRef.current = null;
    reviewedHtmlRef.current = null;
    reviewedTopicsRef.current = null;
    setWorkflowState(null);
    setReviewResult(null);
    setReviewRewrite(null);
    setQualityResult(null);
    rememberGeneratedImageCandidates([]);
    coverUserTouchedRef.current = false;
    writeEditorContent({ html: "", json: null, text: "" });
  }

  async function loadDraftCards() {
    const items = await getContents().catch(() => []);
    setReferenceChoices(items.filter((item) => item.status === "published"));
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

  function applyWorkflowState(state: ContentWorkflowState) {
    setWorkflowState(state);
    setEditingStatus(state.content.status);
    setLastContentSummary(state.content);
    setReviewResult(state.latestAudit ? { content: state.content, audit: state.latestAudit.audit } : null);
    setReviewRewrite(state.latestAudit?.rewrite ?? null);
    const currentQualityInput = persistedQualityInputRef.current;
    const qualityInputIsCurrent = currentQualityInput?.contentId === state.content.id
      && currentQualityInput.title === titleForSave(titleRef.current)
      && currentQualityInput.body === editorText();
    if (state.latestQuality && qualityInputIsCurrent) {
      setQualityResult(state.latestQuality);
    } else {
      setQualityResult(null);
    }
  }

  async function refreshWorkflowState(targetId = contentId ?? lastContentSummary?.id ?? null) {
    if (!targetId) return null;
    const state = await getContentWorkflowState(targetId);
    applyWorkflowState(state);
    if (state.latestAudit?.audit.passed && !state.currentAuditValid) {
      setStatusMessage(
        state.currentAuditBlockReason === "IMAGE_REVIEW_REQUIRED"
          ? "文字审核通过，但当前作品仍有图片未通过审核；请重新进行内容审核。"
          : "上次审核结果不再对应当前内容或图片，请重新进行内容审核。",
      );
    }
    return state;
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
        router.push("/studio/editor", { scroll: false });
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
    const response = await getOfficialTopics(8).catch(() => ({ items: [] }));
    setHotTopics(response.items);
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
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setLocationStatus("unsupported");
      setLocationCandidates([]);
      if (manual) setStatusMessage("当前 HTTP 访问不支持浏览器定位，请使用地点搜索，或配置 HTTPS 后再获取附近地点");
      return;
    }

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
          if (manual) setStatusMessage(locationErrorMessage(error, "附近地点获取失败"));
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
      setLocationCandidates([]);
      setStatusMessage(locationErrorMessage(error, "地点搜索失败"));
    } finally {
      setIsSearchingLocation(false);
    }
  }

  // 内容持久化的总出口，负责把编辑器当前状态的内容保存到云端，并返回最新的内容记录
  async function persistContent() {
    const nextBody = editorText();
    const lengthError = articleLengthBlockReason(title, nextBody);
    if (lengthError) throw new Error(lengthError);
    const payload = {
      title: titleForSave(title),
      body: nextBody,
      bodyHtml: editorHtml(),
      bodyJson: editorJson(),
      tags: selectedTopics,
      assetIds: buildContentAssetIds(),
      visibility,
      scheduledAt: publishTimeMode === "scheduled" && scheduledAt ? scheduledAt : null,
    };
    const targetContentId = currentEditorContentId();
    if (targetContentId) {
      const updated = await updateContent(targetContentId, payload);
      setEditingStatus(updated.status);
      setLastContentSummary(updated);
      persistedQualityInputRef.current = { contentId: updated.id, title: payload.title, body: payload.body };
      await attachCurrentConversation(updated.id);
      return updated;
    }
    const created = await createContent(payload);
    contentIdRef.current = created.id;
    setContentId(created.id);
    setEditingStatus(created.status);
    setLastContentSummary(created);
    persistedQualityInputRef.current = { contentId: created.id, title: payload.title, body: payload.body };
    await attachCurrentConversation(created.id);
    skipNextEditorInitRef.current = created.id;
    window.history.replaceState(null, "", `/studio/editor?contentId=${created.id}`);
    return created;
  }

  async function attachCurrentConversation(targetContentId: string) {
    const currentConversationId = conversationIdRef.current;
    if (!currentConversationId) return;
    try {
      const linked = await attachCreativeConversation(currentConversationId, targetContentId);
      rememberConversationId(linked.conversationId);
      setInvalidConversationLabel(null);
      setChatHistoryError("");
    } catch {
      setChatHistoryError("聊天记录暂未关联到作品，请稍后重试");
    }
  }

  function rememberReviewInput(content: ContentDetail, submittedHtml: string) {
    reviewedAssetIdsRef.current = content.assets.map((item) => item.id).sort();
    reviewedHtmlRef.current = submittedHtml;
    reviewedTopicsRef.current = normalizeTopicList(content.tags);
  }

  // 确保草稿在云端有对应的内容记录，返回 contentId
  async function ensureContentForDraft(data: DraftCache) {
    if (data.contentId) {
      const recovery = unverifiedCloudRecoveryRef.current;
      if (recovery?.contentId === data.contentId) {
        const remote = await getDraft(data.contentId);
        if (!shouldRestoreLocalDraft(recovery.localSavedAt, remote, false)) {
          throw new Error("云端草稿比恢复的本地草稿更新；本地修改已保留，请重新打开并核对");
        }
        unverifiedCloudRecoveryRef.current = null;
      }
      return data.contentId;
    }

    // 如果没有 contentId，说明是新草稿，先创建一个内容记录再进行后续的自动保存，避免后续自动保存时频繁创建内容记录
    const created = await createContent({
      title: titleForSave(data.title),
      body: data.body,
      bodyHtml: data.html,
      bodyJson: data.json,
      tags: data.selectedTopics,
      assetIds: buildContentAssetIds(data.assetIds, data.coverAssetId ?? null, data.coverPreview, data.coverMode),
      visibility: data.visibility,
      scheduledAt: data.publishTimeMode === "scheduled" && data.scheduledAt ? data.scheduledAt : null,
    });
    setContentId(created.id);
    contentIdRef.current = created.id;
    setEditingStatus(created.status);

    // 静默修改URL，避免页面跳转导致编辑中断，同时也让用户可以通过 URL 直接访问这个草稿
    skipNextEditorInitRef.current = created.id;
    window.history.replaceState(null, "", `/studio/editor?contentId=${created.id}`);

    // 如果之前已经有 conversationId，说明用户在编辑过程中进行了聊天交互，此时需要把这个 conversation 关联到新创建的内容上
    await attachCurrentConversation(created.id);
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
    setQualityResult(null);
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
    setQualityResult(null);
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

  function openGenerationUpload(target: "brief" | "chat") {
    setGenerationMenuTarget(null);
    generationUploadTargetRef.current = target;
    generationInputRef.current?.click();
  }

  function openGenerationLibrary(target: "brief" | "chat") {
    setGenerationMenuTarget(null);
    setAssetPanel(target === "brief" ? "generation-brief" : "generation-chat");
    void loadAssets();
  }

  function toggleReferenceContent(id: string) {
    if (referenceContentIds.includes(id)) setReferenceContentIds((items) => items.filter((item) => item !== id));
    else if (referenceContentIds.length >= 5) {
      setStatusMessage("涓€娆℃渶澶氬弬鑰?5 绡囧凡鍙戝竷鏂囩珷");
      return;
    } else setReferenceContentIds((items) => [...items, id]);
    scheduleLocalDraftSave();
    scheduleCloudAutosave();
  }

  function temporaryReferenceControl(target: "brief" | "chat") {
    return (
      <div ref={(node) => { referencePickerRefs.current[target] = node; }} className="relative">
        <button type="button" aria-expanded={referencePickerTarget === target} onClick={() => setReferencePickerTarget((open) => open === target ? null : target)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300">
          参考旧文{referenceContentIds.length ? ` · ${referenceContentIds.length}` : ""}
        </button>
        {referencePickerTarget === target ? (
          <div className="absolute bottom-full left-0 z-40 mb-2 max-h-64 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
            {referenceChoices.length ? referenceChoices.map((item) => (
              <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-xs text-slate-700 hover:bg-slate-50">
                <input type="checkbox" checked={referenceContentIds.includes(item.id)} onChange={() => toggleReferenceContent(item.id)} disabled={!referenceContentIds.includes(item.id) && referenceContentIds.length >= 5} className="mt-0.5 accent-[#ff2442]" />
                <span className="line-clamp-2">{item.title || "未命名作品"}</span>
              </label>
            )) : <p className="px-2 py-3 text-xs text-slate-400">没有可参考的已发布文章</p>}
          </div>
        ) : null}
      </div>
    );
  }

  function removeInvalidGenerationMaterial(target: "brief" | "chat", label: string) {
    if (target === "brief") setInvalidBriefMaterialIds((items) => items.filter((item) => item !== label));
    else setInvalidChatMaterialIds((items) => items.filter((item) => item !== label));
    scheduleLocalDraftSave();
    scheduleCloudAutosave();
  }

  function addGenerationAsset(target: "brief" | "chat", asset: AssetSummary) {
    const isDocument = isGenerationDocument(asset);
    const isImage = isImageAsset(asset);
    const selected = target === "brief" ? briefMaterials : chatMaterials;
    if (!isDocument && !isImage) {
      setStatusMessage(`文件类型不可用于生成：${asset.fileName}`);
      return false;
    }
    if (isDocument && (asset.source !== "uploaded" || typeof asset.metadata?.storageKey !== "string")) {
      setStatusMessage(`文档没有可读取的原始上传文件：${asset.fileName}`);
      return false;
    }
    if (asset.auditStatus !== "approved" && !(isImage && asset.auditStatus === "pending")) {
      setStatusMessage(`文件尚未通过审核：${asset.fileName}`);
      return false;
    }
    if (selected.some((item) => item.id === asset.id)) return true;
    if (isDocument && selected.filter(isGenerationDocument).length >= 3) {
      setStatusMessage("每次最多选择 3 份文档");
      return false;
    }
    if (target === "brief") setBriefMaterials((items) => [...items, asset]);
    else setChatMaterials((items) => [...items, asset]);
    if (isImage) {
      if (!assetIds.includes(asset.id)) generationAttachedImageIdsRef.current.add(asset.id);
      setAssetIds((items) => Array.from(new Set([...items, asset.id])));
    }
    scheduleLocalDraftSave();
    scheduleCloudAutosave();
    setStatusMessage(`已选择文件：${asset.fileName}`);
    return true;
  }

  async function uploadGenerationFiles(files: File[], target: "brief" | "chat") {
    if (!files.length || isUploadingGenerationMaterials) return;
    const selected = target === "brief" ? briefMaterials : chatMaterials;
    let documentCount = selected.filter(isGenerationDocument).length;
    let uploadedCount = 0;
    const errors: string[] = [];
    setIsUploadingGenerationMaterials(true);
    try {
      for (const file of files) {
        const isDocument = /\.(?:txt|md|markdown|pdf|docx)$/i.test(file.name);
        const isLargeDocument = /\.(?:pdf|docx)$/i.test(file.name);
        const isImage = /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.name);
        if (!isDocument && !isImage) {
          errors.push(`${file.name}：仅支持 TXT、MD、PDF、DOCX 和图片`);
          continue;
        }
        const maxBytes = isLargeDocument ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
        if (isDocument && file.size > maxBytes) {
          errors.push(`${file.name}：${isLargeDocument ? "PDF/DOCX 文件不能超过 10 MB" : "TXT/MD 文件不能超过 2 MB"}`);
          continue;
        }
        if (isDocument && documentCount >= 3) {
          errors.push("每次最多选择 3 份文档");
          continue;
        }
        try {
          // Generation materials remain user-owned assets. They are linked to
          // the article only when selected as image attachments.
          const asset = await uploadAsset({ file });
          if ((isDocument && !isGenerationDocument(asset)) || (isImage && !isImageAsset(asset))) {
            errors.push(`${file.name}：上传后的文件类型不匹配`);
            continue;
          }
          setAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)]);
          if (isDocument && asset.auditStatus !== "approved") {
            errors.push(`${file.name}：${asset.auditStatus === "pending" ? "审核中，请通过后从已有文件选择" : "未通过审核，不能用于生成"}`);
            continue;
          }
          if (target === "brief") setBriefMaterials((items) => [...items, asset]);
          else setChatMaterials((items) => [...items, asset]);
          if (isDocument) documentCount += 1;
          if (isImage) {
            generationAttachedImageIdsRef.current.add(asset.id);
            setAssetIds((items) => Array.from(new Set([...items, asset.id])));
          }
          uploadedCount += 1;
        } catch (error) {
          errors.push(`${file.name}：${error instanceof Error ? error.message : "上传失败"}`);
        }
      }
      if (errors.length) setStatusMessage(errors.join("；"));
      else if (uploadedCount) setStatusMessage(`已添加 ${uploadedCount} 个文件`);
      if (uploadedCount) {
        setAssetPanel((current) => current === `generation-${target}` ? null : current);
        scheduleLocalDraftSave();
        scheduleCloudAutosave();
      }
    } finally {
      setIsUploadingGenerationMaterials(false);
    }
  }

  function removeGenerationMaterial(target: "brief" | "chat", asset: AssetSummary) {
    if (target === "brief") setBriefMaterials((items) => items.filter((item) => item.id !== asset.id));
    else setChatMaterials((items) => items.filter((item) => item.id !== asset.id));
    if (isImageAsset(asset)) {
      const otherMaterials = target === "brief" ? chatMaterials : briefMaterials;
      if (generationAttachedImageIdsRef.current.has(asset.id)
        && !otherMaterials.some((item) => item.id === asset.id)
        && coverAssetIdRef.current !== asset.id
        && !editorHtml().includes(asset.url)) {
        setAssetIds((items) => items.filter((id) => id !== asset.id));
        generationAttachedImageIdsRef.current.delete(asset.id);
      }
    }
    scheduleLocalDraftSave();
    scheduleCloudAutosave();
    setStatusMessage(`已从本次生成移除：${asset.fileName}`);
  }

  function generationMaterialTags(target: "brief" | "chat") {
    const selected = target === "brief" ? briefMaterials : chatMaterials;
    const invalid = target === "brief" ? invalidBriefMaterialIds : invalidChatMaterialIds;
    if (!selected.length && !invalid.length && !referenceContentIds.length && !invalidReferenceIds.length) return <div>{temporaryReferenceControl(target)}</div>;
    return (
      <div className="flex flex-wrap gap-2" aria-label="已选择的文件">
        {temporaryReferenceControl(target)}
        {selected.map((asset) => (
          <span key={asset.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white py-1 pl-2.5 pr-1 text-xs text-slate-700">
            {isImageAsset(asset) ? <ImagePlus size={13} /> : <FileText size={13} />}
            <span className="max-w-40 truncate" title={asset.fileName}>{asset.fileName}</span>
            {asset.auditStatus !== "approved" ? <span className="text-amber-700">{asset.auditStatus === "pending" ? "审核中" : "审核未通过"}</span> : null}
            <button type="button" onClick={() => removeGenerationMaterial(target, asset)} aria-label={`移除 ${asset.fileName}`} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X size={13} />
            </button>
          </span>
        ))}
        {invalid.map((label) => (
          <span key={`invalid-${label}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-200 bg-amber-50 py-1 pl-2.5 pr-1 text-xs text-amber-800">
            <FileText size={13} />
            <span className="max-w-40 truncate" title={label}>{label} · 不可用</span>
            <button type="button" onClick={() => removeInvalidGenerationMaterial(target, label)} aria-label={`移除不可用素材 ${label}`} className="rounded-full p-1 text-amber-700 hover:bg-amber-100"><X size={13} /></button>
          </span>
        ))}
      </div>
    );
  }

  function generationFileButton(target: "brief" | "chat") {
    return (
      <div className="relative shrink-0" data-generation-file-menu>
        <button
          type="button"
          onClick={() => setGenerationMenuTarget((current) => current === target ? null : target)}
          disabled={isUploadingGenerationMaterials || isBusy || target === "chat" && isChatStreaming}
          aria-label={target === "brief" ? "添加本次生成文件" : "添加聊天文件"}
          aria-expanded={generationMenuTarget === target}
          title="添加 TXT、MD、PDF、DOCX 或图片"
          className={`inline-flex items-center justify-center border border-slate-200 bg-white text-slate-700 hover:border-[#ff2442] hover:text-[#ff2442] disabled:opacity-50 ${target === "brief" ? "size-11 rounded-2xl" : "size-10 rounded-xl"}`}
        >
          <Plus size={target === "brief" ? 20 : 19} />
        </button>
        {generationMenuTarget === target ? (
          <div className="absolute bottom-full left-0 z-20 mb-2 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
            <button type="button" onClick={() => openGenerationUpload(target)} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">上传文件</button>
            <button type="button" onClick={() => openGenerationLibrary(target)} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">选择已有文件</button>
          </div>
        ) : null}
      </div>
    );
  }

  function registerGeneratedAsset(asset: GeneratedImageAsset, generatedAssetIds: string[]) {
    if (!generatedAssetIds.includes(asset.id)) generatedAssetIds.push(asset.id);
    setAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)]);
    setAssetIds((items) => Array.from(new Set([...generatedAssetIds, ...items])));
  }

  function toGeneratedImageCandidate(
    value: {
      asset: GeneratedImageAsset;
      role: "cover" | "inline";
      operationId?: string;
      position?: string;
      prompt?: string;
      slotId?: string;
      fallbackReason?: string;
    }
  ): GeneratedImageCandidate {
    return {
      asset: value.asset,
      role: value.role,
      operationId: value.operationId ?? `generated-${value.asset.id}`,
      inserted: false,
      position: value.position,
      prompt: value.prompt,
      slotId: value.slotId,
      fallbackReason: value.fallbackReason,
    };
  }

  function currentEditorContentId() {
    return contentIdRef.current ?? editingContentId;
  }

  function assertEditorContentScope(targetContentId?: string | null) {
    const currentContentId = currentEditorContentId();
    if (!targetContentId || !currentContentId || targetContentId === currentContentId) return;
    throw new Error("AI 任务属于另一篇文章，已阻止结果写入当前编辑器");
  }

  function assertEditorJobScope(targetJob: AiJobSnapshot) {
    if (isAiJobInEditorScope(currentEditorContentId(), targetJob)) return;
    throw new Error("AI 任务属于另一篇文章，已阻止结果写入当前编辑器");
  }

  async function commitCreativeJobResult(
    resultJob: AiJobSnapshot,
    result: unknown,
    event: AiJobEvent,
    partialAssetIds: string[] = [],
  ) {
    if (!event.id) throw new Error("result_ready event is missing its persisted event ID");
    assertEditorJobScope(resultJob);
    let next: DraftCache;
    const pendingCommit = listStoredAiJobs().find((item) => item.jobId === resultJob.id)?.pendingCommit;

    if (pendingCommit?.resultEventId === event.id) {
      next = snapshotFromPendingCommit(pendingCommit.content);
      await applySnapshot(next);
    } else if (resultJob.type === AiJobType.CreativeDirectGenerate) {
      const generated = result as DirectGenerateResult;
      finishGeneratedDraft(generated, partialAssetIds);
      const generatedIds = [
        generated.coverAsset?.id,
        ...(generated.imageAssets ?? []).map((item) => item.id),
        ...partialAssetIds,
      ].filter((id): id is string => Boolean(id));
      const current = snapshot();
      next = {
        ...current,
        contentId: resultJob.contentId ?? contentIdRef.current ?? null,
        title: generated.title,
        body: editorText(),
        html: editorHtml(),
        json: editorJson(),
        selectedTopics: normalizeTopicList(generated.tags),
        coverPreview: coverPreviewRef.current,
        coverAssetId: coverAssetIdRef.current,
        assetIds: Array.from(new Set([...generatedIds, ...current.assetIds])),
        generatedImageCandidates: generatedImageCandidatesRef.current,
      };
    } else if (resultJob.type === AiJobType.CreativeImageGenerate) {
      const asset = (result as { asset?: GeneratedImageAsset }).asset;
      if (!asset) throw new Error("AI image result is missing its asset");
      const position = typeof resultJob.input?.position === "string" ? resultJob.input.position : "";
      setAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)]);
      if (position === "封面") {
        setCoverFromAsset(asset);
        setCoverPickerOpen(false);
      } else {
        insertAsset(asset);
      }
      const current = snapshot();
      next = {
        ...current,
        contentId: resultJob.contentId ?? contentIdRef.current ?? null,
        body: editorText(),
        html: editorHtml(),
        json: editorJson(),
        coverPreview: coverPreviewRef.current,
        coverAssetId: coverAssetIdRef.current,
        assetIds: Array.from(new Set([asset.id, ...current.assetIds])),
      };
    } else {
      throw new Error(`AI job ${resultJob.type} does not require editor commit`);
    }

    const commitRequest = {
      resultEventId: event.id,
      content: {
        contentId: next.contentId ?? undefined,
        title: next.title,
        body: next.body,
        bodyHtml: next.html,
        bodyJson: next.json,
        tags: next.selectedTopics,
        assetIds: next.assetIds,
        payload: editorDraftPayload(next),
      },
    };
    setStoredAiJobPendingCommit(resultJob.id, commitRequest);
    const committed = await commitAiJobResult(resultJob.id, commitRequest);
    clearStoredAiJobPendingCommit(resultJob.id);
    contentIdRef.current = committed.content.id;
    setContentId(committed.content.id);
    setEditingStatus(committed.content.status);
    setLastContentSummary(committed.content);
    persistedQualityInputRef.current = {
      contentId: committed.content.id,
      title: titleForSave(next.title),
      body: next.body,
    };
    skipNextEditorInitRef.current = committed.content.id;
    window.history.replaceState(null, "", `/studio/editor?contentId=${committed.content.id}`);
    appliedRestoredAiJobIdsRef.current.add(resultJob.id);
    setStatusMessage("AI 结果已回填并保存到云端");
    await loadAssets();
  }

  async function handleEditorJobDone(doneJob: AiJobSnapshot, result: unknown) {
    assertEditorJobScope(doneJob);
    if (doneJob.type === AiJobType.CreativeDirectGenerate || doneJob.type === AiJobType.CreativeImageGenerate) {
      if (!doneJob.contentId) return;
      const [detail, cloudDraft] = await Promise.all([getContentDetail(doneJob.contentId), getDraft(doneJob.contentId)]);
      contentIdRef.current = doneJob.contentId;
      await applySnapshot(snapshotFromCloudDraft(cloudDraft, detail));
      persistedQualityInputRef.current = { contentId: detail.id, title: detail.title, body: detail.body };
      setEditingStatus(detail.status);
      setLastContentSummary(detail);
      window.history.replaceState(null, "", `/studio/editor?contentId=${doneJob.contentId}`);
      appliedRestoredAiJobIdsRef.current.add(doneJob.id);
      setStatusMessage("AI 结果已保存");
      return;
    }
    applyRestoredEditorJobResult(doneJob, result);
  }

  function editorDraftPayload(data: DraftCache): Record<string, unknown> {
    return {
      html: data.html,
      json: data.json,
      tags: data.selectedTopics,
      coverPreview: data.coverPreview,
      coverAssetId: data.coverAssetId,
      coverMode: data.coverMode,
      assetIds: data.assetIds,
      briefTheme: data.briefTheme,
      materialNotes: data.materialNotes,
      briefMaterialIds: data.briefMaterialIds ?? [],
      chatMaterialIds: data.chatMaterialIds ?? [],
      referenceContentIds: data.referenceContentIds ?? [],
      writingStyleMode: data.writingStyleMode ?? "off",
      writingStyleVersionId: data.writingStyleVersionId ?? "",
      writingTopicKey: data.writingTopicKey ?? "",
      conversationId: data.conversationId ?? "",
      audience: data.audience,
      style: data.style,
      viewpoint: data.viewpoint,
      publishTimeMode: data.publishTimeMode,
      scheduledAt: data.scheduledAt,
      selectedLocation: data.selectedLocation,
      visibility: data.visibility,
      originalStatement: data.originalStatement,
      contentStatement: data.contentStatement,
      generatedImageCandidates: data.generatedImageCandidates ?? [],
    };
  }

  function snapshotFromPendingCommit(content: {
    contentId?: string;
    title: string;
    body: string;
    bodyHtml?: string | null;
    bodyJson?: Record<string, unknown> | null;
    tags: string[];
    assetIds: string[];
    payload: Record<string, unknown>;
  }): DraftCache {
    const current = snapshot();
    const payload = content.payload;
    return {
      ...current,
      contentId: content.contentId ?? current.contentId,
      title: content.title,
      body: content.body,
      html: content.bodyHtml ?? textToEditorHtml(content.body),
      json: content.bodyJson ?? null,
      selectedTopics: content.tags,
      assetIds: content.assetIds,
      coverPreview: typeof payload.coverPreview === "string" ? payload.coverPreview : current.coverPreview,
      coverAssetId: typeof payload.coverAssetId === "string" ? payload.coverAssetId : null,
      coverMode: payload.coverMode === "none" ? "none" : "single",
      briefTheme: typeof payload.briefTheme === "string" ? payload.briefTheme : current.briefTheme,
      audience: typeof payload.audience === "string" ? payload.audience : current.audience,
      style: typeof payload.style === "string" ? payload.style : current.style,
      viewpoint: typeof payload.viewpoint === "string" ? payload.viewpoint : current.viewpoint,
      publishTimeMode: payload.publishTimeMode === "scheduled" ? "scheduled" : "now",
      scheduledAt: typeof payload.scheduledAt === "string" ? payload.scheduledAt : "",
      selectedLocation: typeof payload.selectedLocation === "string" ? payload.selectedLocation : "",
      visibility: payload.visibility === "followers" || payload.visibility === "private" ? payload.visibility : "public",
      originalStatement: Boolean(payload.originalStatement),
      contentStatement: typeof payload.contentStatement === "string" ? payload.contentStatement : current.contentStatement,
      generatedImageCandidates: Array.isArray(payload.generatedImageCandidates)
        ? payload.generatedImageCandidates as GeneratedImageCandidate[]
        : [],
    };
  }

  function applyRestoredEditorJobResult(restoredJob: AiJobSnapshot, result: unknown) {
    if (appliedRestoredAiJobIdsRef.current.has(restoredJob.id) || !result) return;
    assertEditorJobScope(restoredJob);

    if (restoredJob.type === AiJobType.CreativeDirectGenerate) {
      finishGeneratedDraft(result as DirectGenerateResult, []);
      appliedRestoredAiJobIdsRef.current.add(restoredJob.id);
      void loadAssets();
      return;
    }

    if (restoredJob.type === AiJobType.CreativeImageGenerate) {
      const asset = (result as { asset?: GeneratedImageAsset }).asset;
      if (!asset) return;
      const position = typeof restoredJob.input?.position === "string" ? restoredJob.input.position : "";
      setAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)]);
      setAssetIds((items) => Array.from(new Set([asset.id, ...items])));
      if (position === "封面") {
        setCoverFromAsset(asset);
        setCoverPickerOpen(false);
        setStatusMessage("AI 封面图任务已恢复并回填");
      } else {
        insertAsset(asset);
        setStatusMessage("AI 正文配图任务已恢复并插入");
      }
      appliedRestoredAiJobIdsRef.current.add(restoredJob.id);
      void loadAssets();
      return;
    }

    if (restoredJob.type === AiJobType.ContentSubmitReview) {
      const reviewed = result as {
        content: ContentSummary;
        audit: AuditResult;
        quality: null;
        rewrite: ReviewRewrite;
      };
      if (!reviewed.content || !reviewed.audit) return;
      applyReviewJobResult(reviewed);
      appliedRestoredAiJobIdsRef.current.add(restoredJob.id);
      void refreshWorkflowState(reviewed.content.id).catch(() => null);
      void loadDraftCards();
      return;
    }

    if (restoredJob.type === AiJobType.ContentApprove) {
      const approved = result as ContentApprovalResult;
      if (!approved.content || !approved.quality) return;
      setLastContentSummary(approved.content);
      setEditingStatus(approved.content.status);
      setQualityResult(approved.quality);
      setWorkflowState((current) =>
        current
          ? {
              ...current,
              content: approved.content,
              latestQuality: { ...approved.quality, scoredAt: new Date().toISOString() },
              currentAuditValid: true,
              currentAuditBlockReason: undefined,
              canScoreQuality: true,
              qualityBlockReason: undefined,
              canPublish:
                approved.content.status === ContentStatus.Approved ||
                approved.content.status === ContentStatus.Updated ||
                approved.content.status === ContentStatus.PendingReview ||
                approved.content.status === ContentStatus.Scheduled,
            }
          : current
      );
      appliedRestoredAiJobIdsRef.current.add(restoredJob.id);
      setStatusMessage(`质量评估任务已恢复，综合得分 ${approved.quality.total}`);
      void refreshWorkflowState(approved.content.id).catch(() => null);
    }
  }

  // 完成生成的草稿内容的收尾工作，包括设置标题、话题、封面图，注册生成的图片素材，写入编辑器内容，以及提示用户后续需要确认的生成图片
  function finishGeneratedDraft(generated: DirectGenerateResult, generatedAssetIds: string[]) {
    setTitle(generated.title);
    titleRef.current = generated.title;
    setQualityResult(null);
    setSelectedTopics(normalizeTopicList(generated.tags));
    setTitleCandidates(generated.titleCandidates.filter((candidate) => candidate.title !== generated.title));
    setShowTitleCandidates(false);

    const candidates: GeneratedImageCandidate[] = [];
    if (generated.coverAsset) {
      registerGeneratedAsset(generated.coverAsset, generatedAssetIds);
      if (!coverPreviewRef.current && !coverUserTouchedRef.current) {
        setCoverFromAsset(generated.coverAsset, { auto: true });
      } else {
        candidates.push(
          toGeneratedImageCandidate({
            asset: generated.coverAsset,
            role: "cover",
            fallbackReason: coverUserTouchedRef.current ? "你已手动设置封面，未自动覆盖" : "当前已有封面，未自动覆盖",
          })
        );
      }
      setCoverPickerOpen(false);
    }

    for (const asset of generated.imageAssets ?? []) {
      registerGeneratedAsset(asset, generatedAssetIds);
    }

    const rendered = renderGeneratedDraftWithImages(
      generated.bodyMarkdown,
      generated.title,
      (generated.imageAssets ?? []).map((asset) => ({
        asset,
        position: asset.position,
        prompt: asset.prompt,
        slotId: asset.slotId,
      }))
    );
    writeEditorMarkup(rendered.html);

    candidates.push(
      ...rendered.unplaced.map((item) =>
        toGeneratedImageCandidate({
          asset: item.asset,
          role: "inline",
          position: item.position ?? item.asset.position,
          prompt: item.prompt ?? item.asset.prompt,
          slotId: item.slotId ?? item.asset.slotId,
          fallbackReason: item.fallbackReason,
        })
      )
    );
    rememberGeneratedImageCandidates(candidates);

    const ids = [
      generated.coverAsset?.id,
      ...(generated.imageAssets ?? []).map((item) => item.id),
      ...generatedAssetIds,
    ].filter((id): id is string => Boolean(id));
    if (ids.length) setAssetIds((items) => Array.from(new Set([...ids, ...items])));
    scheduleLocalDraftSave();
    scheduleCloudAutosave();

    const placedCount = rendered.placed.length;
    const fallbackCount = candidates.length;
    setStatusMessage(
      fallbackCount
        ? `AI 图文已填充，${placedCount} 张正文配图已自动插入，${fallbackCount} 张图片待确认`
        : placedCount
          ? `AI 图文已填充，${placedCount} 张正文配图已自动插入`
          : generated.coverAsset
            ? "AI 图文和封面已填充"
            : "AI 图文已填充，图片稍后可单独生成",
    );
  }

  // 左侧 AI 一键生成初稿：只使用创作简报字段，右侧对话入口不再复用这个直接生成函数。
  async function openWritingStyleSetup() {
    setWritingStyleSetupOpen(true);
    setWritingStyleCandidate(null);
    setWritingStyleSelectedIds([]);
    setWritingStylePage(1);
    setWritingStyleSetupBusy(true);
    try {
      const page = await getEligibleWritingSkillContents(1, 20);
      setWritingStyleItems(page.items ?? []);
      setWritingStyleTotal(page.total ?? 0);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "加载可选文章失败");
    } finally {
      setWritingStyleSetupBusy(false);
    }
  }

  async function loadWritingStylePage(pageNumber: number) {
    setWritingStyleSetupBusy(true);
    try {
      const page = await getEligibleWritingSkillContents(pageNumber, 20);
      setWritingStyleItems(page.items ?? []);
      setWritingStyleTotal(page.total ?? 0);
      setWritingStylePage(pageNumber);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "加载可选文章失败");
    } finally {
      setWritingStyleSetupBusy(false);
    }
  }

  async function buildWritingStyleCandidate() {
    if (writingStyleSelectedIds.length < 3 || writingStyleSelectedIds.length > 20 || writingStyleSetupBusy) return;
    setWritingStyleSetupBusy(true);
    setStatusMessage("正在分析你选择的文章…");
    try {
      const created = await buildWritingSkill(writingStyleSelectedIds);
      let job = created;
      for (let attempt = 0; attempt < 1200; attempt += 1) {
        if (job.status === "succeeded") break;
        if (job.status === "failed" || job.status === "cancelled") throw new Error(job.errorMessage || "写作风格生成失败");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        job = await getAiJob(created.id);
      }
      if (job.status !== "succeeded") throw new Error("生成时间较长，请稍后重试");
      const result = job.result as any;
      setWritingStyleCandidate(result.candidateVersion.profile as WritingStyleProfile);
      setWritingSkill(await getWritingSkill());
      setStatusMessage("候选写法已生成。检查并编辑后确认，即可用于本次创作。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "写作风格生成失败");
    } finally {
      setWritingStyleSetupBusy(false);
    }
  }

  async function confirmWritingStyleAndGenerate() {
    const candidateVersion = writingSkill?.candidateVersion;
    if (!candidateVersion || !writingStyleCandidate || writingStyleSetupBusy) return;
    setWritingStyleSetupBusy(true);
    try {
      const confirmed = await confirmWritingSkill({
        candidateVersionId: candidateVersion.id,
        editedProfile: writingStyleCandidate,
        expectedSourceRevision: writingSkill.sourceRevision,
        expectedEditRevision: writingSkill.editRevision,
      });
      const refreshed = {
        ...writingSkill,
        activeVersionId: confirmed.activeVersionId,
        activeVersion: confirmed.activeVersion,
        candidateVersion: null,
        pauseReason: null,
      };
      setWritingSkill(refreshed);
      setWritingStyleMode("common");
      setWritingTopicKey("");
      setWritingStyleSetupOpen(false);
      setStatusMessage("写作风格已确认，正在按你的写法生成初稿…");
      await runBriefDraftSkill({ mode: "common", versionId: confirmed.activeVersionId });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "确认写作风格失败");
    } finally {
      setWritingStyleSetupBusy(false);
    }
  }

  async function runBriefDraftSkill(styleOverride?: { mode: "common" | "topic"; versionId: string; topicKey?: string }) {
    const theme = briefTheme.trim();
    if (!theme) {
      setStatusMessage("请先填写创作简报里的主题");
      return;
    }
    if (isBusy || isUploadingGenerationMaterials) return;
    const activeStyleVersionId = writingSkill?.activeVersion?.id;
    if (!styleOverride && writingStyleMode !== "off" && (!activeStyleVersionId || writingSkill?.pauseReason)) {
      setStatusMessage("当前写作风格不可用，请先检查或重新确认档案");
      return;
    }
    if (!styleOverride && writingStyleMode === "topic" && !writingTopicKey) {
      setStatusMessage("请先选择要使用的主题写法");
      return;
    }
    const selectedStyle = styleOverride ?? (writingStyleMode === "off" ? undefined : {
      mode: writingStyleMode as "common" | "topic",
      ...(writingStyleMode === "topic" ? { topicKey: writingTopicKey } : {}),
      versionId: activeStyleVersionId as string,
    });

    setActiveOperation("draft");
    setBriefGenerationStage(null);
    rememberGeneratedImageCandidates([]);
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
            materialNotes,
            referenceContentIds,
            ...generationMaterialIds(briefMaterials),
            ...(selectedStyle ? {
              writingStyle: { mode: selectedStyle.mode, ...(selectedStyle.topicKey ? { topicKey: selectedStyle.topicKey } : {}) },
              expectedVersionId: selectedStyle.versionId,
            } : {}),
          }),
        {
          onProgress: (data) => {
            if (typeof data.message === "string") setStatusMessage(data.message);
          },
          onPartial: (data) => {
            if (data.kind === "generationStage" && data.value && typeof data.value === "object") {
              setBriefGenerationStage(data.value as GenerationStageView);
              return;
            }
            if (data.kind === "draft") {
              setStatusMessage("AI 初稿和配图方案已生成，正在生成图片...");
            }

            if (data.kind === "imageAsset") {
              const value = data.value as { asset?: GeneratedImageAsset; cover?: boolean; position?: string };
              if (value.asset && !generatedAssetIds.includes(value.asset.id)) generatedAssetIds.push(value.asset.id);
              setStatusMessage(value.cover ? "封面图已生成，正在等待完整图文完成..." : `正文配图已生成：${value.position ?? value.asset?.position ?? "正文配图"}`);
            }
          },
          onWarning: (message) => setStatusMessage(message),
          onResultReady: (job, result, event) => commitCreativeJobResult(job, result, event, generatedAssetIds),
          onDone: (job, result) => handleEditorJobDone(job, result),
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
      setBriefGenerationStage(null);
      setActiveOperation(null);
    }
  }

  // AI 生成封面图，优先使用创作简报的主题，如果没有则使用正文前40字作为主题，生成后加入素材库并设置为封面预览
  async function generateCoverImage() {
    const currentBody = editorText();
    const targetContentId = currentEditorContentId();
    const normalizedTitle = title.trim();
    const meaningfulTitle = normalizedTitle && normalizedTitle !== "未命名草稿" ? normalizedTitle : "";
    const bodyTopic = currentBody
      .split(/(?:\r?\n)+|[。！？]/)
      .map((item) => item.trim())
      .find((item) => item.length >= 6)
      ?.slice(0, 120) ?? "";
    const theme = briefTheme.trim() || meaningfulTitle || bodyTopic;
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
            contentId: targetContentId ?? undefined,
            position: "封面",
            prompt: [
              `主题：${theme}`,
              "用途：今日头条信息流封面图，画面主体清晰，留出标题文字空间。",
              meaningfulTitle ? `当前标题：${meaningfulTitle}` : "",
              "只根据文章主题设计视觉画面，不要在图片中复述正文长文本。",
            ].filter(Boolean).join("\n"),
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
          onResultReady: async (job, result, event) => {
            const value = result as { asset?: GeneratedImageAsset };
            if (value.asset) generated.asset = value.asset;
            await commitCreativeJobResult(job, result, event);
          },
          onDone: (job, result) => handleEditorJobDone(job, result),
          onError: (message) => setStatusMessage(`AI 封面生成失败：${message}`),
        },
      );
      if (imageJob.status !== "succeeded") {
        throw new Error(imageJob.errorMessage ?? "AI 封面生成失败");
      }
      if (appliedRestoredAiJobIdsRef.current.has(imageJob.id)) return;
      const finalAsset = generated.asset;
      if (!finalAsset) {
        setStatusMessage("图片模型暂未返回封面图");
        return;
      }
      setCoverFromAsset(finalAsset);
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
    const targetContentId = currentEditorContentId();
    setActiveOperation("inline-image");
    setStatusMessage("AI 正在生成正文配图...");
    try {
      const generated = { asset: null as GeneratedImageAsset | null };
      const imageJob = await runJob(
        () =>
          startCreativeImageJob({
            contentId: targetContentId ?? undefined,
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
          onResultReady: async (job, result, event) => {
            const value = result as { asset?: GeneratedImageAsset };
            if (value.asset) generated.asset = value.asset;
            await commitCreativeJobResult(job, result, event);
          },
          onDone: (job, result) => handleEditorJobDone(job, result),
          onError: (message) => setStatusMessage(`AI 配图生成失败：${message}`),
        },
      );
      if (imageJob.status !== "succeeded") {
        throw new Error(imageJob.errorMessage ?? "AI 配图生成失败");
      }
      if (appliedRestoredAiJobIdsRef.current.has(imageJob.id)) return;
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
      const job = await runJob(
        () => generateCreativeTitles({
          currentTitle: title || undefined,
          body: currentBody,
          platform: "今日头条",
        }),
        {
          onProgress: (data) => {
            if (typeof data.message === "string") setStatusMessage(data.message);
          },
          onError: (message) => setStatusMessage(message),
        },
      );
      const result = titleGenerateResult(job.result);
      if (!result) throw new Error("标题任务返回结果无效");
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

  function setAssistantSkillStatus(assistantId: string, text: string) {
    if (!text.trim()) return;
    setChatMessages((items) => items.some((item) => item.id === assistantId)
      ? items.map((item) =>
        item.id === assistantId && item.kind !== "skill_result"
          ? { ...item, kind: "skill_status", content: text, insertable: false }
          : item,
      )
      : [...items, { id: assistantId, role: "assistant", kind: "skill_status", content: text, insertable: false }]);
  }

  function setAssistantFinalReply(assistantId: string, text: string) {
    setChatMessages((items) => items.some((item) => item.id === assistantId)
      ? items.map((item) => item.id === assistantId
      ? { ...item, kind: "skill_result", content: text, insertable: false }
      : item)
      : [...items, { id: assistantId, role: "assistant", kind: "skill_result", content: text, insertable: false }]);
  }

  function setAssistantGenerationStage(assistantId: string, value: unknown) {
    if (!value || typeof value !== "object") return;
    const stage = value as GenerationStageView;
    const label = stage.phase ? GENERATION_STAGE_LABELS[stage.phase] : undefined;
    if (!label) return;
    const topic = writingStyleMode === "topic"
      ? writingSkill?.activeVersion?.profile?.topics?.find((item: { key: string; label: string }) => item.key === writingTopicKey)?.label
      : undefined;
    const skill = stage.skillKey === "content-production-line" ? "完整图文创作 Skill" : stage.skillKey ?? "完整图文创作 Skill";
    setAssistantSkillStatus(assistantId, `**${label}**\n\n使用：${skill}${topic ? ` · ${topic}写作风格` : ""}\n\n配图：${generationImageProgress(stage)}`);
  }

  function shouldOfferChatActions(message: ChatMessage) {
    return message.role === "assistant" && (message.kind ?? "chat") === "chat" && Boolean(message.content.trim());
  }

  // 对话式 AI 生成：由对话中的 AI Agent 触发，可能是生成初稿、生成图片等多种技能
  // 整个过程在对话气泡里展示进度和结果，用户可以在对话里直接确认生成的图片并插入到编辑器中
  async function runConversationDraftJob(event: CreativeChatSkillEvent, assistantId: string) {
    if (!event.job) return;
    if (event.job.status === "succeeded") {
      try {
        await handleEditorJobDone(event.job, event.job.result);
        setAssistantFinalReply(assistantId, "图文已生成，正文和配图已回填。");
      } catch (error) {
        setAssistantFinalReply(assistantId, `图文已生成，但恢复编辑器失败：${error instanceof Error ? error.message : "请刷新页面重试"}`);
      }
      return;
    }
    if (event.job.status === "failed" || event.job.status === "cancelled") {
      setAssistantFinalReply(assistantId, event.job.status === "cancelled" ? "图文生成已取消。" : `图文生成失败：${event.job.errorMessage ?? "AI 生成失败"}`);
      return;
    }
    const generatedAssetIds: string[] = [];
    let commitError: string | null = null;
    setActiveOperation("draft");
    rememberGeneratedImageCandidates([]);
    setStatusMessage("AI Agent 已选择一键图文生成，正在执行...");
    setAssistantSkillStatus(assistantId, "正在生成完整图文...");
    try {
      const job = await runJob(
        () => Promise.resolve(event.job!),
        {
          onProgress: (data) => {
            if (typeof data.message === "string") {
              setStatusMessage(data.message);
            }
          },
          onPartial: (data) => {
            if (data.kind === "generationStage") {
              setAssistantGenerationStage(assistantId, data.value);
              return;
            }
            if (data.kind === "draft") {
              setStatusMessage("AI 初稿和配图方案已生成，正在生成图片...");
            }
            if (data.kind === "imageAsset") {
              const value = data.value as { asset?: GeneratedImageAsset; cover?: boolean; position?: string; slotId?: string };
              if (value.asset && !generatedAssetIds.includes(value.asset.id)) generatedAssetIds.push(value.asset.id);
              const label = value.cover ? "封面图" : value.position ?? value.asset?.position ?? "正文配图";
              setStatusMessage(`${label}已生成，正在等待完整图文完成...`);
            }
          },
          onWarning: (message) => {
            setStatusMessage(message);
          },
          onResultReady: async (job, result, event) => {
            await commitCreativeJobResult(job, result, event, generatedAssetIds);
            setPendingCreativeCommitJobId(null);
          },
          onError: (message, failedJob) => {
            if (failedJob?.status === "awaiting_commit") {
              commitError = message;
              setPendingCreativeCommitJobId(failedJob.id);
              setStatusMessage(`图文已生成，但保存失败：${message}`);
              setAssistantSkillStatus(assistantId, `图文已生成，但保存失败：${message}。请点击“继续保存图文”。`);
              return;
            }
            setStatusMessage(`AI 生成失败：${message}`);
            if (failedJob?.status === "failed" || failedJob?.status === "cancelled") {
              setAssistantFinalReply(assistantId, failedJob.status === "cancelled" ? "图文生成已取消。" : `图文生成失败：${message}`);
            }
          },
        },
      );
      if (job.status === "cancelled") {
        setAssistantFinalReply(assistantId, "图文生成已取消。");
        return;
      }
      if (job.status === "failed") {
        setAssistantFinalReply(assistantId, `图文生成失败：${job.errorMessage ?? "AI 生成失败"}`);
        return;
      }
      if (job.status === "awaiting_commit") {
        setPendingCreativeCommitJobId(job.id);
        if (!commitError) setAssistantSkillStatus(assistantId, "图文已生成，等待保存。请点击“继续保存图文”。");
        return;
      }
      if (job.status !== "succeeded") {
        setAssistantFinalReply(assistantId, "图文任务连接中断，生成仍可能在后台继续。请刷新页面恢复任务状态。");
        return;
      }
      setPendingCreativeCommitJobId(null);
      setAssistantFinalReply(assistantId, "图文已生成，正文和配图已回填。");
      await loadAssets();
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 生成失败";
      setStatusMessage(`AI 生成失败：${message}`);
      setAssistantFinalReply(assistantId, `图文生成失败：${message}`);
    } finally {
      setActiveOperation(null);
    }
  }

  async function continuePendingCreativeCommit() {
    const jobId = pendingCreativeCommitJobId;
    if (!jobId || busyOperation !== null || isAiJobRunning || isChatStreaming) return;
    setActiveOperation("draft");
    setStatusMessage("正在继续保存已生成的图文...");
    try {
      const job = await resumeJob(jobId, {
        onResultReady: (readyJob, result, event) => commitCreativeJobResult(readyJob, result, event),
        onDone: async (doneJob, result) => {
          await handleEditorJobDone(doneJob, result);
          if (doneJob.assistantMessageId) setAssistantFinalReply(doneJob.assistantMessageId, "图文已生成，正文和配图已回填。");
          setPendingCreativeCommitJobId(null);
        },
        onError: (message, failedJob) => {
          setStatusMessage(`图文保存失败：${message}`);
          if (failedJob?.status === "awaiting_commit") setPendingCreativeCommitJobId(failedJob.id);
        },
      });
      if (job.status === "awaiting_commit") setPendingCreativeCommitJobId(job.id);
      else if (job.status === "succeeded") setPendingCreativeCommitJobId(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? `图文保存失败：${error.message}` : "图文保存失败，请重试");
    } finally {
      setActiveOperation(null);
    }
  }

  async function discardPendingCreativeCommit() {
    const jobId = pendingCreativeCommitJobId;
    if (!jobId || busyOperation !== null || isAiJobRunning || isChatStreaming) return;
    try {
      const cancelled = await cancelJob(jobId);
      if (cancelled?.assistantMessageId) setAssistantFinalReply(cancelled.assistantMessageId, "图文生成结果已放弃。");
      setPendingCreativeCommitJobId(null);
      setStatusMessage("已放弃待保存的图文结果");
    } catch (error) {
      setStatusMessage(error instanceof Error ? `取消待保存结果失败：${error.message}` : "取消待保存结果失败");
    }
  }

  // 内容安全审核流程：由对话中的 AI Agent 触发，执行后会把审核结果同步到发布流转面板的内容详情里
  // 用户可以根据审核反馈调整内容后继续提交审核，直到通过为止
  async function runConversationReviewJob(event: CreativeChatSkillEvent, assistantId: string) {
    if (!event.job || busyOperation !== null) return;
    setActiveOperation("audit");
    setReviewRewrite(null);
    setStatusMessage("AI Agent 已选择内容安全审核，正在执行...");
    setAssistantSkillStatus(assistantId, "正在审核当前内容。");
    try {
      const reviewJob = await runJob(
        () => Promise.resolve(event.job!),
        {
          onProgress: (data) => {
            if (typeof data.message === "string") setStatusMessage(data.message);
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
      applyReviewJobResult(reviewed);
      setAssistantSkillStatus(assistantId, "内容审核已完成，结果已同步到发布流转面板。");
      await refreshWorkflowState(reviewed.content.id).catch(() => null);
      await loadDraftCards();
    } catch (error) {
      const message = error instanceof Error ? error.message : "内容审核失败";
      setStatusMessage(`内容审核失败：${message}`);
      setAssistantSkillStatus(assistantId, `审核失败：${message}`);
    } finally {
      setActiveOperation(null);
    }
  }

  async function runConversationReviewAfterPersist(assistantId: string) {
    if (busyOperation !== null) return;
    setActiveOperation("audit");
    setReviewRewrite(null);
    setAssistantSkillStatus(assistantId, "正在先保存当前内容，再执行安全审核。");
    try {
      const submittedHtml = editorHtml();
      const saved = await persistContent();
      rememberReviewInput(saved, submittedHtml);
      const reviewJob = await runJob(
        () => startSubmitReviewJob(saved.id),
        {
          onProgress: (data) => {
            if (typeof data.message === "string") setStatusMessage(data.message);
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
      applyReviewJobResult(reviewJob.result as {
        content: ContentSummary;
        audit: AuditResult;
        quality: null;
        rewrite: ReviewRewrite;
      });
      setAssistantSkillStatus(assistantId, "内容审核已完成，结果已同步到发布流转面板。");
      await refreshWorkflowState(saved.id).catch(() => null);
      await loadDraftCards();
    } catch (error) {
      const message = error instanceof Error ? error.message : "内容审核失败";
      setStatusMessage(`内容审核失败：${message}`);
      setAssistantSkillStatus(assistantId, `审核失败：${message}`);
    } finally {
      setActiveOperation(null);
    }
  }

  function handleCreativeChatSkillEvent(event: CreativeChatSkillEvent, assistantId: string): Promise<void> | undefined {
    if (event.type === "skill_started") {
      setAssistantSkillStatus(assistantId, event.message ?? `已选择：${event.skillKey}`);
      if (event.skillKey === "content-safety-reviewer" && event.data?.requiresContent) {
        return runConversationReviewAfterPersist(assistantId);
      }
      return;
    }

    if (event.type === "job_started") {
      if (event.skillKey === "content-production-line") {
        return runConversationDraftJob(event, assistantId);
      } else if (event.skillKey === "content-safety-reviewer") {
        return runConversationReviewJob(event, assistantId);
      }
      return;
    }

    if (event.type === "skill_error") {
      const message = event.message ?? "Skill 执行失败";
      setStatusMessage(message);
      setAssistantSkillStatus(assistantId, message);
    }
  }

  // Chat is a durable job. Starting another chat only detaches the old SSE;
  // it does not cancel the old server task.
  async function sendCreativeChatMessage() {
    const message = chatInput.trim();
    if (!message || isBusy || isChatStreaming || streamLockRef.current || isUploadingGenerationMaterials) return;
    if (writingStyleMode === "topic" && !writingTopicKey) {
      setStatusMessage("请先在创作简报中选择要使用的主题写法");
      return;
    }
    if (writingStyleMode !== "off" && (!writingSkill?.activeVersion?.id || writingSkill?.pauseReason)) {
      setStatusMessage("当前写作风格不可用，请先在创作简报中重新确认档案");
      return;
    }
    const submittedMaterials = chatMaterials;
    streamLockRef.current = true;
    setChatInput("");
    setIsChatStreaming(true);
    const userId = `user-${Date.now()}`;
    const assistantId = `assistant-${Date.now()}`;
    const skillTasks: Promise<void>[] = [];
    setChatMessages((items) => [
      ...items,
      { id: userId, role: "user", content: message, attachments: submittedMaterials.map((item) => item.fileName) },
      { id: assistantId, role: "assistant", kind: "chat", content: "" },
    ]);
    try {
      await runJob(
        () => startAiJob({
          type: AiJobType.CreativeChat,
          conversationId: conversationIdRef.current,
          assistantMessageId: assistantId,
          contentId: contentIdRef.current ?? undefined,
          payload: {
            conversationId: conversationIdRef.current,
            contentId: contentIdRef.current ?? undefined,
            message,
            currentTitle: title,
            currentBody: editorText(),
            selectedText: selectionMenu?.text,
            ...generationMaterialIds(submittedMaterials),
            referenceContentIds,
            ...(writingStyleMode !== "off" && writingSkill?.activeVersion?.id && !writingSkill?.pauseReason ? {
              writingStyle: { mode: writingStyleMode, ...(writingStyleMode === "topic" ? { topicKey: writingTopicKey } : {}) },
              expectedVersionId: writingSkill.activeVersion.id,
            } : {}),
            assistantMessageId: assistantId,
          },
        }),
        {
          onSnapshot: (snapshot) => {
            chatJobIdRef.current = snapshot.id;
            setChatMaterials((items) => items.filter((item) => !submittedMaterials.some((submitted) => submitted.id === item.id)));
          },
          onPartial: (data) => {
            if (data.kind !== "creativeChatEvent" || !data.value || typeof data.value !== "object") return;
            const event = data.value as { type?: string; data?: Record<string, unknown> };
            if (event.type === "meta" && typeof event.data?.conversationId === "string") {
              rememberConversationId(event.data.conversationId);
              setChatHistoryError("");
            }
            if (event.type === "delta") {
              const text = typeof event.data?.text === "string" ? event.data.text : "";
              setChatMessages((items) =>
                items.map((item) =>
                  item.id === assistantId
                  ? { ...item, content: `${item.content}${text}` }
                  : item,
                ),
              );
            }
            if (event.type === "skill") {
              const skillEvent = event.data as unknown as CreativeChatSkillEvent;
              if (skillEvent.type === "job_started" && skillEvent.job) chatJobIdRef.current = skillEvent.job.id;
              const task = handleCreativeChatSkillEvent(skillEvent, assistantId);
              if (task) skillTasks.push(task);
            }
          },
          onDone: async (parentJob, rawResult) => {
            const event = rawResult as { conversationId?: string; messageId?: string; content?: string };
            if (event.conversationId) rememberConversationId(event.conversationId);
            if (!skillTasks.length && !event.content?.trim() && event.conversationId) {
              const relatedJobs = await recoverAiJobs({ conversationId: event.conversationId, limit: 20 }).catch(() => []);
              const childJob = relatedJobs.find((item) => item.type === AiJobType.CreativeDirectGenerate && item.assistantMessageId === parentJob.assistantMessageId);
              if (childJob) {
                chatJobIdRef.current = childJob.id;
                skillTasks.push(runConversationDraftJob({ type: "job_started", skillKey: "content-production-line", job: childJob }, assistantId));
              }
            }
            if (skillTasks.length) {
              return;
            }
            if (!event.content?.trim()) {
              setAssistantFinalReply(assistantId, "本次 AI 任务没有返回回复，请刷新页面查看任务状态后重试。");
              chatJobIdRef.current = null;
              return;
            }
            let hasInsertableMessage = false;
            setChatMessages((items) =>
              items.map((item) =>
                item.id === assistantId
                  ? (() => {
                      const insertable = shouldOfferChatActions(item);
                      hasInsertableMessage = hasInsertableMessage || insertable;
                      return item.kind === "skill_status" || item.kind === "skill_result"
                        ? { ...item, insertable: false }
                        : { ...item, id: event.messageId ?? item.id, content: item.content.trim() || "AI 未返回回复，请重试。", insertable };
                    })()
                  : item,
              ),
            );
            setStatusMessage(hasInsertableMessage ? "AI 回复完成，可插入正文或生成配图" : "AI 回复完成");
            chatJobIdRef.current = null;
          },
          onError: (text) => {
            setStatusMessage(text);
            setChatMessages((items) => items.map((item) => item.id === assistantId
              ? { ...item, kind: "chat", content: item.content.trim() ? `${item.content}\n\n${text}` : `本次 AI 请求失败：${text}`, insertable: false }
              : item));
            chatJobIdRef.current = null;
          },
        },
      );
      await Promise.allSettled(skillTasks);
    } catch (error) {
      const failure = error instanceof Error ? `AI 对话失败：${error.message}` : "AI 对话失败";
      setStatusMessage(failure);
      setChatMessages((items) => items.map((item) => item.id === assistantId
        ? { ...item, kind: "chat", content: item.content.trim() ? `${item.content}\n\n${failure}` : failure, insertable: false }
        : item));
      chatJobIdRef.current = null;
    } finally {
      chatJobIdRef.current = null;
      streamLockRef.current = false;
      setIsChatStreaming(false);
    }
  }

  async function stopCreativeChat() {
    const jobId = chatJobIdRef.current;
    if (!jobId) return;
    await cancelJob(jobId).catch(() => undefined);
    chatJobIdRef.current = null;
    streamLockRef.current = false;
    setIsChatStreaming(false);
    setStatusMessage("AI 任务已取消");
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
      const job = await runJob(
        () => rewriteSelection({
          selectedText,
          action,
          surroundingContext: editorText(),
          tone: action === "tone" ? tone || "亲和口语" : undefined,
        }),
        {
          onProgress: (data) => {
            if (typeof data.message === "string") setStatusMessage(data.message);
          },
          onError: (message) => setStatusMessage(message),
        },
      );
      const result = selectionRewriteResult(job.result);
      if (!result) throw new Error("选区改写任务返回结果无效");
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
    if (intent === "cover") {
      setCoverCropFile(file);
      return;
    }
    const isLargeDocument = /\.(?:pdf|docx)$/i.test(file.name);
    const isTextDocument = /\.(?:txt|md|markdown)$/i.test(file.name);
    if ((isLargeDocument && file.size > 10 * 1024 * 1024) || (isTextDocument && file.size > 2 * 1024 * 1024)) {
      setStatusMessage(`${file.name}：${isLargeDocument ? "PDF/DOCX 文件不能超过 10 MB" : "TXT/MD 文件不能超过 2 MB"}`);
      return;
    }
    setIsUploadingAsset(true);
    try {
      const asset = await uploadAsset({ file, contentId: contentId ?? undefined });
      setAssets((items) => [
        asset,
        ...items.filter((item) => item.id !== asset.id),
      ]);
      setAssetIds((items) => Array.from(new Set([asset.id, ...items])));
      if (isImageAsset(asset)) {
        if (intent === "insert") {
          insertAsset(asset);
        } else {
          if (!coverPreview) setCoverFromAsset(asset);
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

  async function uploadCroppedCover(file: File) {
    setCoverCropFile(null);
    setIsUploadingCover(true);
    try {
      const asset = await uploadAsset({ file, contentId: contentId ?? undefined });
      setAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)]);
      setAssetIds((items) => Array.from(new Set([asset.id, ...items])));
      setCoverFromAsset(asset);
      setCoverPickerOpen(false);
      setStatusMessage(`封面图已上传：${asset.fileName}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? `封面上传失败：${error.message}` : "封面上传失败");
      setCoverCropFile(file);
    } finally {
      setIsUploadingCover(false);
    }
  }

  function insertAsset(asset: AssetSummary, options: { setCoverIfMissing?: boolean } = {}) {
    const shouldSetCoverIfMissing = options.setCoverIfMissing ?? true;
    setAssetIds((items) => Array.from(new Set([asset.id, ...items])));
    if (isImageAsset(asset)) {
      if (!editorRef.current) {
        const figure = `<figure><img src="${asset.url}" alt="${escapeHtml(asset.fileName)}" /></figure>`;
        writeEditorMarkup(`${editorHtml()}${figure}`, editorText());
        setStatusMessage("图片素材已插入正文");
        if (shouldSetCoverIfMissing && !coverPreview) setCoverFromAsset(asset);
        return;
      } else {
        editorRef.current.insertImage(asset.url, asset.fileName);
      }
      syncBodyFromEditor("图片素材已插入正文");
      if (shouldSetCoverIfMissing && !coverPreview) setCoverFromAsset(asset);
      return;
    }
    const preview = textAssetPreview(asset);
    insertHtml(
      markdownToEditorHtml(preview) || `<p>${escapeHtml(preview)}</p>`,
      "文本素材已插入正文",
    );
  }

  function applyGeneratedImageCandidate(candidate: GeneratedImageCandidate) {
    if (candidate.role === "cover") {
      setCoverFromAsset(candidate.asset);
      setCoverPickerOpen(false);
      setStatusMessage("候选封面已设为当前封面");
    } else {
      insertAsset(candidate.asset, { setCoverIfMissing: false });
      setStatusMessage("候选配图已插入正文");
    }
    rememberGeneratedImageCandidates((items) => items.filter((item) => item.asset.id !== candidate.asset.id));
    scheduleLocalDraftSave();
    scheduleCloudAutosave();
  }

  function dismissGeneratedImageCandidate(assetId: string) {
    rememberGeneratedImageCandidates((items) => items.filter((item) => item.asset.id !== assetId));
    scheduleLocalDraftSave();
    scheduleCloudAutosave();
  }

  function removeCover() {
    clearCover();
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
      setBriefMaterials((items) => items.filter((item) => item.id !== asset.id));
      setChatMaterials((items) => items.filter((item) => item.id !== asset.id));
      generationAttachedImageIdsRef.current.delete(asset.id);
      if (coverPreview === asset.url) clearCover();
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

  function applyReviewJobResult(reviewed: {
    content: ContentSummary;
    audit: AuditResult;
    quality: null;
    rewrite: ReviewRewrite;
  }) {
    assertEditorContentScope(reviewed.content.id);
    setEditingStatus(reviewed.content.status);
    setLastContentSummary(reviewed.content);
    setWorkflowState((current) => ({
      content: reviewed.content,
      latestAudit: {
        content: reviewed.content,
        audit: reviewed.audit,
        rewrite: reviewed.rewrite,
        checkedAt: new Date().toISOString(),
      },
      latestQuality: current?.latestQuality,
      currentAuditValid: reviewed.audit.passed,
      currentAuditBlockReason: reviewed.audit.passed ? undefined : "CONTENT_REJECTED",
      canScoreQuality: reviewed.audit.passed,
      qualityBlockReason: reviewed.audit.passed ? undefined : "CONTENT_REJECTED",
      canPublish:
        reviewed.content.status === ContentStatus.Approved ||
        reviewed.content.status === ContentStatus.Updated ||
        reviewed.content.status === ContentStatus.PendingReview ||
        reviewed.content.status === ContentStatus.Scheduled,
      publishBlockReason: reviewed.audit.passed ? undefined : "内容安全审核未通过，请先修改后重新审核",
    }));
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
    void loadAssets();
  }

  // 提交审核前先保存内容；这里只做安全合规，安全通过后即可发布。
  async function submitForReview() {
    if (coverCropFile || isUploadingCover) {
      setStatusMessage("请先完成封面裁剪和上传，再进行内容审核");
      return;
    }
    if (isBusy) return;
    setActiveOperation("audit");
    setReviewRewrite(null);
    setStatusMessage("正在保存内容，准备内容审核...");
    try {
      const submittedHtml = editorHtml();
      const saved = await persistContent();
      rememberReviewInput(saved, submittedHtml);
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

      applyReviewJobResult(reviewed);
      await refreshWorkflowState(reviewed.content.id).catch(() => null);
      await loadDraftCards();
    } catch (error) {
      await loadAssets();
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
    if (isBusy) return;

    setActiveOperation("quality");
    setQualityResult(null);
    setStatusMessage("正在保存当前内容，准备质量评估...");
    try {
      const saved = await persistContent();
      const evaluatedTitle = titleForSave(title);
      const evaluatedBody = editorText();
      const currentState = await refreshWorkflowState(saved.id);
      if (!currentState?.canScoreQuality) {
        throw new Error("当前内容尚未通过有效的安全审核，请重新进行内容审核后再评估。");
      }
      setStatusMessage("内容已保存，正在进行质量评估与打分...");
      const job = await runJob(
        () => startQualityScoreJob(saved.id),
        {
          onProgress: (data) => {
            if (typeof data.message === "string") setStatusMessage(data.message);
          },
          onPartial: (data) => {
            if (data.kind === "quality") {
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
      const editorStillMatchesEvaluatedVersion = titleForSave(titleRef.current) === evaluatedTitle
        && editorText() === evaluatedBody;
      if (editorStillMatchesEvaluatedVersion) setQualityResult(approved.quality);
      else setQualityResult(null);
      setWorkflowState((current) =>
        current
          ? {
              ...current,
              content: approved.content,
              latestQuality: { ...approved.quality, scoredAt: new Date().toISOString() },
              currentAuditValid: true,
              currentAuditBlockReason: undefined,
              canScoreQuality: true,
              qualityBlockReason: undefined,
              canPublish:
                approved.content.status === ContentStatus.Approved ||
                approved.content.status === ContentStatus.Updated ||
                approved.content.status === ContentStatus.PendingReview ||
                approved.content.status === ContentStatus.Scheduled,
            }
          : current,
      );
      await refreshWorkflowState(approved.content.id).catch(() => null);
      setStatusMessage(editorStillMatchesEvaluatedVersion
        ? `质量评估完成，综合得分 ${approved.quality.total}`
        : "质量评估完成，但评估期间内容有变更；当前报告已隐藏，请对最新内容重新评估。");
    } catch (error) {
      setQualityResult(null);
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
    if (coverCropFile || isUploadingCover) {
      setStatusMessage("请先完成封面裁剪和上传，再发布内容");
      return;
    }
    if (isBusy) return;
    const targetId = contentId ?? lastContentSummary?.id;
    if (!targetId) {
      setStatusMessage("请先保存内容后再发布");
      return;
    }
    setActiveOperation("publish");
    setStatusMessage("正在保存当前内容，准备发布...");
    try {
      const saved = await persistContent();
      const latestState = await refreshWorkflowState(saved.id);
      if (!latestState) throw new Error("无法读取最新审核状态，请稍后重试");
      if (!latestState.canPublish) {
        setStatusMessage(latestState.publishBlockReason ?? "内容需要先通过安全审核后才能发布");
        return;
      }
      setStatusMessage("内容已保存，正在发布...");
      const publishScheduledAt = publishTimeMode === "scheduled" && scheduledAt ? scheduledAt : null;
      if (publishTimeMode === "scheduled" && !publishScheduledAt) {
        setStatusMessage("请先选择定时发布时间");
        return;
      }
      const published = await publishContent(saved.id, {
        visibility,
        scheduledAt: publishScheduledAt,
      });
      setLastContentSummary(published);
      setEditingStatus(published.status);
      setStatusMessage(published.status === ContentStatus.Scheduled ? "定时发布已设置，正在跳转作品管理" : "内容已发布，正在跳转作品管理");
      setPublishSuccess(true);
      publishRedirectTimerRef.current = window.setTimeout(() => {
        router.push(published.status === ContentStatus.Scheduled ? "/studio/content?status=drafts" : "/studio/content?status=published");
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
    const action = replacement.replacement ? "替换" : "删除";
    if (changed) {
      setProcessedRiskItemIds((prev) => new Set([...prev, replacement.riskItemId]));
    }
    setStatusMessage(changed ? `已${action}风险片段：${replacement.reason}` : "未找到可处理的风险片段");
  }

  function applyAllReplacements() {
    const replacements = reviewActions;
    if (!replacements.length) {
      setStatusMessage("暂无可处理的风险片段");
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
      titleRef.current = nextTitle;
      setQualityResult(null);
    }
    if (changed > 0) {
      setProcessedRiskItemIds((prev) => {
        const next = new Set(prev);
        for (const replacement of sorted) {
          next.add(replacement.riskItemId);
        }
        return next;
      });
    }
    setStatusMessage(changed ? `已处理 ${changed} 个风险片段` : "未找到可处理的风险片段");
  }

  function applyReplacementByRiskItem(replacement: ComplianceReplacement, riskItem?: AuditRiskItem) {
    if (riskItem?.field === "title") {
      const result = replaceInTextByRiskItem(title, replacement, riskItem);
      if (result.changed) {
        setTitle(result.text);
        titleRef.current = result.text;
        setQualityResult(null);
      }
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
        <aside className="space-y-5 xl:sticky xl:top-[var(--app-page-y)] xl:max-h-[var(--app-sticky-panel-height)] xl:overflow-y-auto xl:pr-1">
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
                <label className="block">
                  <span className={FIELD_LABEL_CLASS_NAME}>补充信息</span>
                  <textarea
                    id="brief-material-notes"
                    value={materialNotes}
                    onChange={(event) => setMaterialNotes(event.target.value)}
                    rows={3}
                    placeholder="例如：亲自体验了 3 天，花费约 200 元，实际效果是……"
                    className={`${FIELD_CONTROL_CLASS_NAME} resize-none`}
                  />
                </label>
                {generationMaterialTags("brief")}
                {writingStyleSetupOpen && typeof document !== "undefined" && createPortal(
                  <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setWritingStyleSetupOpen(false); }}>
                    <section role="dialog" aria-modal="true" aria-labelledby="writing-style-setup-title" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-2xl">
                      <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
                        <div><h3 id="writing-style-setup-title" className="text-lg font-semibold text-slate-900">建立我的写作风格</h3><p className="mt-1 text-sm text-slate-500">从已发布文章中提炼可编辑的写作档案</p></div>
                        <button type="button" aria-label="关闭" onClick={() => setWritingStyleSetupOpen(false)} className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100"><X size={18} /></button>
                      </header>
                      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 sm:p-6">
                        {writingStyleCandidate ? (
                          <>
                            <p className="text-sm text-slate-600">检查并编辑 AI 从所选文章中提炼的写法。确认后本次初稿会直接使用该版本。</p>
                            <label className="block"><span className={FIELD_LABEL_CLASS_NAME}>整体概括</span><textarea value={writingStyleCandidate.summary} onChange={(event) => setWritingStyleCandidate({ ...writingStyleCandidate, summary: event.target.value })} rows={3} className={`${FIELD_CONTROL_CLASS_NAME} resize-y`} /></label>
                            <div className="grid gap-3 sm:grid-cols-2">{writingStyleFields.map(([key, label]) => <label key={key} className="block"><span className={FIELD_LABEL_CLASS_NAME}>{label}</span><textarea value={writingStyleCandidate.common[key]} onChange={(event) => setWritingStyleCandidate({ ...writingStyleCandidate, common: { ...writingStyleCandidate.common, [key]: event.target.value } })} rows={3} className={`${FIELD_CONTROL_CLASS_NAME} resize-y`} /></label>)}</div>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-slate-600">选择 3–20 篇自己已发布的文章；AI 会提炼写作方法供你编辑确认。</p>
                            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white px-4">{writingStyleItems.map((item) => <li key={item.id} className="flex items-start gap-3 py-3"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[#ff2442]" checked={writingStyleSelectedIds.includes(item.id)} disabled={!item.eligible || writingStyleSetupBusy || (!writingStyleSelectedIds.includes(item.id) && writingStyleSelectedIds.length >= 20)} onChange={() => setWritingStyleSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} aria-label={`选择 ${item.title}`} /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium leading-6 text-slate-800">{item.title}</p><p className="mt-0.5 text-xs leading-5 text-slate-500">{item.characterCount} 字{item.reason ? ` · ${item.reason}` : ""}</p></div></li>)}</ul>
                          </>
                        )}
                      </div>
                      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-6">
                        {writingStyleCandidate ? (
                          <><span className="text-sm text-slate-500">确认后将用于本次初稿</span><button type="button" onClick={() => void confirmWritingStyleAndGenerate()} disabled={writingStyleSetupBusy} className="rounded-full bg-[#ff2442] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e91635] disabled:opacity-50">{writingStyleSetupBusy ? "处理中…" : "确认并按此风格生成"}</button></>
                        ) : (
                          <><span className="text-sm text-slate-500">已选 {writingStyleSelectedIds.length}/20 · 共 {writingStyleTotal} 篇</span><div className="flex flex-wrap items-center gap-2"><button type="button" disabled={writingStyleSetupBusy || writingStylePage <= 1} onClick={() => void loadWritingStylePage(writingStylePage - 1)} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-40">上一页</button><button type="button" disabled={writingStyleSetupBusy || writingStylePage * 20 >= writingStyleTotal} onClick={() => void loadWritingStylePage(writingStylePage + 1)} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-40">下一页</button><button type="button" disabled={writingStyleSetupBusy || writingStyleSelectedIds.length < 3} onClick={() => void buildWritingStyleCandidate()} className="rounded-full bg-[#ff2442] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{writingStyleSetupBusy ? "分析中…" : "提炼写法"}</button></div></>
                        )}
                      </footer>
                    </section>
                  </div>,
                  document.body,
                )}
                <div className="flex gap-2">
                  {generationFileButton("brief")}
                  <button
                    type="button"
                    onClick={() => void runBriefDraftSkill()}
                    disabled={isBusy || isUploadingGenerationMaterials}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#ff2442] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#e91635] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Sparkles size={16} />
                    {isOperation("draft") ? "AI 生成中..." : "AI 一键生成初稿"}
                  </button>
                </div>
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
              </div>
            )}
          </section>
        </aside>

        <main className="space-y-5">
          {briefGenerationStage && isOperation("draft") ? (
            <section aria-live="polite" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-rose-100 bg-rose-50 px-5 py-3 text-sm text-slate-700">
              <span className="font-semibold text-[#ff2442]">{GENERATION_STAGE_LABELS[briefGenerationStage.phase ?? ""] ?? "生成图文"}</span>
              <span>使用：{briefGenerationStage.skillKey === "content-production-line" ? "完整图文创作 Skill" : briefGenerationStage.skillKey ?? "完整图文创作 Skill"}</span>
              <span>配图：{generationImageProgress(briefGenerationStage)}</span>
            </section>
          ) : null}
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
                {isOnline ? "在线编辑" : "离线编辑"} · {displayStatusMessage}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <div ref={writingStyleMenuRef} className="relative">
                  <button type="button" aria-haspopup="menu" aria-expanded={writingStyleMenuOpen} onClick={() => setWritingStyleMenuOpen((open) => !open)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${writingStyleMode === "off" ? "border-slate-200 bg-white text-slate-600 hover:border-slate-300" : "border-rose-200 bg-rose-50 text-[#ff2442]"}`}>
                    <span>写作风格：{writingStyleMode === "off" ? "不使用" : writingStyleMode === "common" ? "通用写法" : writingSkill?.activeVersion?.profile?.topics?.find((topic: any) => topic.key === writingTopicKey)?.label ?? "选择主题"}</span>
                    <ChevronDown size={14} className={`transition-transform ${writingStyleMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                  {writingStyleMenuOpen && <div role="menu" aria-label="选择写作风格" className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-100 bg-white p-2 text-left shadow-xl">
                    <p className="px-3 pb-1 pt-2 text-xs font-medium text-slate-400">生成时使用</p>
                    <button type="button" role="menuitem" onClick={() => { setWritingStyleMode("off"); setWritingStyleMenuOpen(false); }} className={`w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50 ${writingStyleMode === "off" ? "font-semibold text-[#ff2442]" : "text-slate-700"}`}>不使用写作风格</button>
                    <button type="button" role="menuitem" disabled={!writingSkill?.activeVersion || Boolean(writingSkill?.pauseReason)} onClick={() => { setWritingStyleMode("common"); setWritingStyleMenuOpen(false); }} className={`w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 ${writingStyleMode === "common" ? "font-semibold text-[#ff2442]" : "text-slate-700"}`}>通用写法</button>
                    <div className="my-2 border-t border-slate-100" />
                    <p className="px-3 pb-1 pt-1 text-xs font-medium text-slate-400">按主题使用</p>
                    {writingSkill?.activeVersion?.profile?.topics?.length && !writingSkill?.pauseReason ? writingSkill.activeVersion.profile.topics.map((topic: any) => <button key={topic.key} type="button" role="menuitem" onClick={() => { setWritingTopicKey(topic.key); setWritingStyleMode("topic"); setWritingStyleMenuOpen(false); }} className={`w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50 ${writingStyleMode === "topic" && writingTopicKey === topic.key ? "font-semibold text-[#ff2442]" : "text-slate-700"}`}>{topic.label}</button>) : <p className="px-3 py-2 text-sm text-slate-400">暂无可用的主题写法</p>}
                    <div className="my-2 border-t border-slate-100" />
                    <button type="button" role="menuitem" onClick={() => { setWritingStyleMenuOpen(false); void openWritingStyleSetup(); }} className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-[#ff2442] hover:bg-rose-50">{writingSkill?.activeVersion ? "管理写作风格" : "建立我的写作风格"}</button>
                    {writingSkill?.pauseReason && <p className="px-3 pb-2 text-xs text-amber-700">档案已暂停，重新建档并确认后即可使用。</p>}
                  </div>}
                </div>
                <button
                  type="button"
                  onClick={() => void autoSaveDraft(true)}
                  disabled={isCloudSaving}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:cursor-wait disabled:opacity-60"
                >
                  {isCloudSaving ? "保存中…" : "保存"}
                </button>
                {pendingCreativeCommitJobId && (
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => void continuePendingCreativeCommit()} disabled={busyOperation !== null || isAiJobRunning || isChatStreaming} className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 disabled:opacity-50">继续保存图文</button>
                    <button type="button" onClick={() => void discardPendingCreativeCommit()} disabled={busyOperation !== null || isAiJobRunning || isChatStreaming} className="rounded-full px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50">放弃</button>
                  </div>
                )}
              </div>
            </div>

            {(invalidAttachmentLabels.length > 0 || invalidReferenceIds.length > 0 || invalidCoverLabel || invalidWritingStyleLabel || invalidConversationLabel) && (
              <div className="mb-4 flex flex-wrap gap-2" aria-label="草稿中已失效的选项">
                {invalidAttachmentLabels.map((label) => <span key={label} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 py-1 pl-3 pr-1 text-xs text-amber-800">{label} · 已失效<button type="button" onClick={() => setInvalidAttachmentLabels((items) => items.filter((item) => item !== label))} aria-label={`移除失效图片 ${label}`} className="rounded-full p-1 hover:bg-amber-100"><X size={13} /></button></span>)}
                {invalidReferenceIds.map((id) => <span key={id} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 py-1 pl-3 pr-1 text-xs text-amber-800">参考旧文已失效<button type="button" onClick={() => setInvalidReferenceIds((items) => items.filter((item) => item !== id))} aria-label="移除失效参考旧文" className="rounded-full p-1 hover:bg-amber-100"><X size={13} /></button></span>)}
                {invalidCoverLabel && <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 py-1 pl-3 pr-1 text-xs text-amber-800">{invalidCoverLabel}<button type="button" onClick={() => setInvalidCoverLabel(null)} aria-label="移除失效封面提示" className="rounded-full p-1 hover:bg-amber-100"><X size={13} /></button></span>}
                {invalidWritingStyleLabel && <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 py-1 pl-3 pr-1 text-xs text-amber-800">{invalidWritingStyleLabel}<button type="button" onClick={() => setInvalidWritingStyleLabel(null)} aria-label="移除失效写作风格提示" className="rounded-full p-1 hover:bg-amber-100"><X size={13} /></button></span>}
                {invalidConversationLabel && <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 py-1 pl-3 pr-1 text-xs text-amber-800">{invalidConversationLabel}<button type="button" onClick={() => setInvalidConversationLabel(null)} aria-label="移除失效聊天提示" className="rounded-full p-1 hover:bg-amber-100"><X size={13} /></button></span>}
              </div>
            )}

            <div className="relative">
              <input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  titleRef.current = event.target.value;
                  setQualityResult(null);
                }}
                placeholder="填写标题会有更多赞哦"
                aria-invalid={titleTooLong}
                aria-describedby="article-title-count"
                className={`w-full rounded-2xl border bg-slate-50 px-4 py-4 pr-16 text-xl font-bold outline-none placeholder:text-slate-300 focus:bg-white ${titleTooLong ? "border-rose-400 focus:border-rose-500" : "border-transparent focus:border-[#ff2442]/20"}`}
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
            <p id="article-title-count" className={`mt-2 text-right text-xs ${titleTooLong ? "font-semibold text-rose-600" : "text-slate-400"}`} role={titleTooLong ? "alert" : undefined}>
              标题 {titleCount}/{ARTICLE_TITLE_MAX_LENGTH}{titleTooLong ? `，超出 ${titleCount - ARTICLE_TITLE_MAX_LENGTH} 字，请缩短后保存` : ""}
            </p>

            {showTitleCandidates ? (
              <div className="mt-3 grid gap-2 rounded-2xl bg-[#fff3f5] p-3">
                {titleCandidates.map((candidate) => (
                  <button
                    key={candidate.title}
                    type="button"
                    onClick={() => {
                      setTitle(candidate.title);
                      titleRef.current = candidate.title;
                      setQualityResult(null);
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

            {generatedImageCandidates.length ? (
              <section className="rounded-2xl border border-rose-100 bg-[#fff7f8] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-black text-slate-900">待插入图片</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      这些图片未能安全自动落位，可确认后手动插入。
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-rose-600">
                    {generatedImageCandidates.length} 张
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {generatedImageCandidates.map((candidate) => (
                    <div key={`${candidate.operationId}-${candidate.asset.id}`} className="overflow-hidden rounded-2xl border border-white bg-white shadow-sm">
                      <div className="aspect-4/3 overflow-hidden bg-slate-100">
                        <img src={candidate.asset.url} alt={candidate.asset.fileName} className="h-full w-full object-cover" />
                      </div>
                      <div className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-bold text-slate-700">
                            {candidate.role === "cover" ? "封面候选" : candidate.position || "正文配图"}
                          </p>
                          <button
                            type="button"
                            onClick={() => dismissGeneratedImageCandidate(candidate.asset.id)}
                            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            title="移除候选"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        {candidate.fallbackReason ? (
                          <p className="mt-2 line-clamp-2 text-xs font-medium text-slate-500">
                            {candidate.fallbackReason}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => applyGeneratedImageCandidate(candidate)}
                          className="mt-3 h-9 w-full rounded-xl bg-[#ff2442] px-3 text-xs font-bold text-white transition hover:bg-[#e91635]"
                        >
                          {candidate.role === "cover" ? "设为封面" : "插入正文"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
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
              <span className={`ml-auto text-sm ${bodyTooLong ? "font-semibold text-rose-600" : "text-slate-400"}`} role={bodyTooLong ? "alert" : undefined}>
                正文 {bodyCount}/{ARTICLE_BODY_MAX_LENGTH}{bodyTooLong ? `，超出 ${bodyCount - ARTICLE_BODY_MAX_LENGTH} 字，请缩短后保存` : ""}
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
                            onError={() => clearCover({ auto: true })}
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
                  {auditResultIsStale ? "审核结果已失效" : contentStatusLabels[editingStatus]}
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

            {!canRunQualityReview && !isBusy && qualityBlockMessage ? (
              <p className="mt-2 text-sm text-amber-700" role="status">
                {qualityBlockMessage}
              </p>
            ) : null}

            {reviewResult && !auditResultIsStale ? (
              <div
                className={`mt-3 rounded-2xl p-3 text-sm ${
                  auditPassedForCurrentContent
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-rose-50 text-rose-800"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-bold">
                    {auditPassedForCurrentContent
                      ? "安全审核通过"
                      : auditResultIsStale
                        ? "上次审核结果已失效，请重新审核当前内容与图片"
                      : "安全审核未通过"}
                  </p>
                  {!reviewResult.audit.passed && reviewActions.length ? (
                    <button
                      type="button"
                      onClick={applyAllReplacements}
                      className="shrink-0 rounded-full bg-[#ff2442] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-rose-100"
                    >
                      一键处理全部风险片段
                    </button>
                  ) : null}
                </div>
                {visibleReviewRiskItems.length ? (
                  <div className="mt-3 grid gap-2">
                    {visibleReviewRiskItems.map((item) => {
                      const replacement = reviewActionByRiskItem.get(
                        item.id,
                      );
                      const isRemoval = replacement && !replacement.replacement;
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
                                {isRemoval ? "处理方式：删除该风险片段" : `替代表达：${replacement.replacement}`}
                              </p>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => applyReplacement(replacement)}
                                  className="shrink-0 rounded-full bg-white px-3 py-1 font-bold text-[#ff2442] shadow-sm transition hover:bg-[#fff3f5]"
                                >
                                  {isRemoval ? "删除该片段" : "替换该片段"}
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
            ) : localQualityInputMatchesPersisted && lastContentSummary?.qualityScore ? (
              <div className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">
                当前质量分：<strong>{lastContentSummary.qualityScore}</strong>
              </div>
            ) : null}
          </section>
        </main>

        <aside className="space-y-5 xl:sticky xl:top-[var(--app-page-y)] xl:max-h-[var(--app-sticky-panel-height)] xl:pr-1">
          <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-slate-950">
              <MessageCircle size={18} className="text-[#ff2442]" />
              <h2 className="font-bold">AI 交互中心</h2>
            </div>
            <div>
              {chatHistoryError ? (
                <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
                  <span>{chatHistoryError}</span>
                  <button type="button" onClick={() => void refreshChatHistory()} className="shrink-0 font-semibold text-[#ff2442]">重试加载</button>
                </div>
              ) : null}
              {!chatMessages.length && !chatHistoryError ? (
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
                      className={`rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-[#fff3f5] text-rose-900" : "border border-slate-100 bg-white text-slate-700"}`}
                    >
                      <div className="mb-1 text-xs font-semibold text-slate-400">
                        {message.role === "user" ? "你" : "AI"}
                      </div>
                      {message.role === "assistant" ? (
                        <div className="overflow-x-auto [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold [&_table]:my-3 [&_table]:min-w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {normalizeChatMarkdown(message.content) || "AI 正在思考..."}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap">{message.content}</p>
                          {message.attachments?.length ? <p className="mt-2 text-xs text-rose-700">附件：{message.attachments.join("、")}</p> : null}
                        </>
                      )}
                      {message.role === "assistant" &&
                      message.kind !== "skill_status" &&
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

            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-2">
              {writingStyleMode !== "off" && writingSkill?.activeVersion?.id && !writingSkill?.pauseReason && <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                <span>完整图文生成将使用{writingStyleMode === "topic" ? `「${writingSkill.activeVersion.profile?.topics?.find((item: any) => item.key === writingTopicKey)?.label ?? "所选主题"}」` : "通用写法"}写作风格</span>
                <button type="button" onClick={() => setWritingStyleMode("off")} className="font-medium text-[#ff2442]">关闭</button></div>}
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                rows={4}
                placeholder="和 AI 讨论选题、修改正文，或直接说生成完整图文/审核当前内容..."
                className="w-full resize-none bg-transparent p-2 text-sm outline-none placeholder:text-slate-400"
              />
              {generationMaterialTags("chat")}
              <div className="mt-2 flex gap-2">
                {generationFileButton("chat")}
                <button
                  type="button"
                  onClick={() => void (isChatStreaming ? stopCreativeChat() : sendCreativeChatMessage())}
                  disabled={(isBusy && !isChatStreaming) || isUploadingGenerationMaterials}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#ff2442] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Sparkles size={16} />
                  {isChatStreaming ? "停止并取消任务" : "发送给 AI"}
                </button>
              </div>
            </div>
          </section>

        </aside>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp"
        className="hidden"
        onChange={(event) => {
          void handleAssetUpload(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={textInputRef}
        type="file"
        accept=".txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(event) => {
          void handleAssetUpload(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={generationInputRef}
        type="file"
        accept=".txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,text/x-markdown,application/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp"
        multiple
        className="hidden"
        onChange={(event) => {
          void uploadGenerationFiles(Array.from(event.target.files ?? []), generationUploadTargetRef.current);
          event.currentTarget.value = "";
        }}
      />

      {coverCropFile ? (
        <CoverCropDialog file={coverCropFile} onCancel={() => setCoverCropFile(null)} onConfirm={(file) => void uploadCroppedCover(file)} />
      ) : null}

      {assetPanel ? (
        <AssetPanel
          mode={assetPanel === "image" || assetPanel === "text" ? assetPanel : "generation"}
          assets={assetPanel === "image" ? imageAssets : assetPanel === "text" ? textAssets : assets.filter((item) => isImageAsset(item) || isGenerationDocument(item))}
          uploading={isUploadingAsset}
          onClose={() => setAssetPanel(null)}
          onUpload={() =>
            assetPanel === "image"
              ? openImageUpload("library")
              : assetPanel === "text"
                ? openTextUpload()
                : openGenerationUpload(assetPanel === "generation-brief" ? "brief" : "chat")
          }
          onInsert={(asset) => {
            if (assetPanel === "generation-brief" || assetPanel === "generation-chat") {
              if (addGenerationAsset(assetPanel === "generation-brief" ? "brief" : "chat", asset)) setAssetPanel(null);
            } else insertAsset(asset);
          }}
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
            <h3 className="mt-4 text-xl font-black text-slate-950">
              {editingStatus === ContentStatus.Scheduled ? "已设置定时发布" : "已发布"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {editingStatus === ContentStatus.Scheduled
                ? "内容会在设定时间自动发布，正在跳转作品管理。"
                : "内容已进入已发布列表，正在跳转作品管理。"}
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
                  onError={() => clearCover({ auto: true })}
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

function titleGenerateResult(value: unknown): TitleGenerateResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidates = (value as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return null;
  const normalized = candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const record = candidate as Record<string, unknown>;
    if (typeof record.title !== "string" || typeof record.reason !== "string") return [];
    return [{ title: record.title, reason: record.reason }];
  });
  return normalized.length === candidates.length ? { candidates: normalized } : null;
}

function selectionRewriteResult(value: unknown): SelectionRewriteResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const replacement = (value as { replacement?: unknown }).replacement;
  return typeof replacement === "string" && replacement.trim() ? { replacement } : null;
}

// 根据 AI 任务类型返回对应的编辑器操作
function editorOperationForJobType(type: AiJobType): EditorOperation {
  if (type === AiJobType.CreativeImageGenerate) return "inline-image";
  if (type === AiJobType.ContentSubmitReview) return "audit";
  if (type === AiJobType.ContentApprove) return "quality";
  return "draft";
}

const FIELD_LABEL_CLASS_NAME = "mb-1 block text-sm font-normal text-slate-700";
const FIELD_CONTROL_CLASS_NAME = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-[#ff2442]/50 focus:ring-4 focus:ring-[#ff2442]/10";

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className={FIELD_LABEL_CLASS_NAME}>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={FIELD_CONTROL_CLASS_NAME} />
    </label>
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
  mode: "image" | "text" | "generation";
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
            <h3 className="text-lg font-bold">{mode === "generation" ? "选择已有文件" : mode === "image" ? "图片素材库" : "文本素材库"}</h3>
            {mode !== "generation" ? <p className="mt-1 text-sm text-slate-400">点击“插入正文”会放到当前光标处；也可以拖到正文指定位置。删除会从个人素材库移除。</p> : null}
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
            <div key={asset.id} draggable={mode !== "generation"} onDragStart={mode === "generation" ? undefined : (event) => onDragStart(event, asset)} className="rounded-2xl border border-slate-100 bg-white p-3 text-left shadow-sm hover:border-rose-100 hover:bg-[#fff3f5]">
              {isImageAsset(asset) ? (
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
                  {mode === "generation" ? "选为本次文件" : "插入正文"}
                </button>
                {mode !== "generation" ? (
                  <button type="button" onClick={() => onDelete(asset)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-rose-50 hover:text-rose-600">
                    删除
                  </button>
                ) : null}
              </div>
            </div>
          )) : <div className="col-span-full grid h-52 place-items-center text-sm text-slate-400">暂无素材，点击右上角添加。</div>}
        </div>
      </div>
    </div>
  );
}
