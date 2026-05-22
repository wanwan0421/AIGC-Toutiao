import { randomUUID } from "node:crypto";
import {
  AuditRiskLevel,
  ContentStatus,
  PromptScene,
  type AiGenerateResult,
  type AssetSummary,
  type AuditResult,
  type ContentDetail,
  type ContentSummary,
  type CreatorProfile,
  type QualityScoreResult
} from "@aicp/shared";
import { mockAuthor, mockContents } from "./mock-data";

export interface UserRecord extends CreatorProfile {
  account: string;
  email?: string;
  phone?: string;
  passwordHash: string;
  preferences: {
    defaultPlatform: string;
    writingStyles: string[];
    domains: string[];
    blockedWords: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface DraftRecord {
  contentId: string;
  authorId: string;
  title?: string;
  body?: string;
  payload?: Record<string, unknown>;
  clientHash?: string;
  savedAt: string;
}

export interface ContentVersionRecord {
  id: string;
  contentId: string;
  version: number;
  title: string;
  body: string;
  snapshot?: Record<string, unknown>;
  createdAt: string;
}

export interface PromptRecord {
  id: string;
  creatorId?: string;
  name: string;
  scene: PromptScene;
  template: string;
  variables: string[];
  model: string;
  modelOptions: Record<string, unknown>;
  version: number;
  status: "active" | "draft" | "disabled";
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecord {
  id: string;
  contentId: string;
  audit: AuditResult;
  quality: QualityScoreResult;
  checkedAt: string;
}

export interface AiCallLogRecord {
  id: string;
  scene: string;
  model: string;
  inputSummary: string;
  output: unknown;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
  createdAt: string;
}

export interface AnalyticsEventRecord {
  id: string;
  userId?: string;
  contentId: string;
  eventType: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

const now = () => new Date().toISOString();
export const DEFAULT_USER_ID = "user_001";

const detailBody = `这篇内容由创作者提供主题、目标人群和素材线索，AI 先生成标题、正文结构、标签与配图建议，再由创作者补充真实体验。

核心建议包括选择透气面料、统一低饱和配色、准备一件空调房外套、用轻量鞋包提高通勤舒适度，并把每一套搭配拆成可复用公式，方便读者收藏和迁移到自己的衣橱。`;

export const users: UserRecord[] = [
  {
    id: DEFAULT_USER_ID,
    account: "creator@example.com",
    email: "creator@example.com",
    passwordHash: "mock-password-hash",
    nickname: mockAuthor.nickname,
    avatarUrl: "",
    preferences: {
      defaultPlatform: "short-note",
      writingStyles: ["种草", "攻略"],
      domains: ["穿搭", "生活方式"],
      blockedWords: []
    },
    createdAt: "2026-05-20T08:00:00.000Z",
    updatedAt: "2026-05-21T08:00:00.000Z"
  }
];

export const contents: ContentDetail[] = mockContents.map((content) => ({
  ...content,
  body: content.id === "content_001" ? detailBody : `${content.excerpt}\n\n这里是可继续编辑和审核的基础正文。`,
  tags: content.title.includes("穿搭")
    ? ["通勤", "穿搭", "夏日"]
    : content.title.includes("露营")
      ? ["露营", "清单", "户外"]
      : ["AI创作", "内容生产"],
  assets: []
}));

export const drafts: DraftRecord[] = contents
  .filter((content) => content.status === ContentStatus.Draft)
  .map((content) => ({
    contentId: content.id,
    authorId: content.author.id,
    title: content.title,
    body: content.body,
    savedAt: content.updatedAt
  }));

export const versions: ContentVersionRecord[] = [];

export const prompts: PromptRecord[] = [
  {
    id: "prompt_generate_short_note",
    creatorId: DEFAULT_USER_ID,
    name: "短图文种草生成",
    scene: PromptScene.Generate,
    template: "根据主题 {{topic}}、目标人群 {{audience}}、风格 {{style}} 生成标题、正文、标签与配图建议。",
    variables: ["topic", "audience", "style", "materials"],
    model: "doubao-seed",
    modelOptions: { temperature: 0.7 },
    version: 1,
    status: "active",
    usageCount: 12,
    createdAt: "2026-05-20T08:00:00.000Z",
    updatedAt: "2026-05-21T08:00:00.000Z"
  },
  {
    id: "prompt_audit_safety",
    creatorId: DEFAULT_USER_ID,
    name: "内容安全审核",
    scene: PromptScene.Audit,
    template: "检查标题和正文是否存在违规风险，输出风险类型、风险等级和原因。",
    variables: ["title", "body"],
    model: "doubao-seed",
    modelOptions: { temperature: 0.2 },
    version: 1,
    status: "active",
    usageCount: 7,
    createdAt: "2026-05-20T08:00:00.000Z",
    updatedAt: "2026-05-21T08:00:00.000Z"
  }
];

export const assets: AssetSummary[] = [
  {
    id: "asset_001",
    fileName: "summer-outfit-cover.jpg",
    mimeType: "image/jpeg",
    url: "/uploads/summer-outfit-cover.jpg",
    auditStatus: "approved"
  }
];

export const contentAssets = new Map<string, string[]>([["content_001", ["asset_001"]]]);
export const audits: AuditRecord[] = [];
export const aiCallLogs: AiCallLogRecord[] = [];
export const analyticsEvents: AnalyticsEventRecord[] = [];
export const sessions = new Map<string, { userId: string; createdAt: string }>();

export function createId(prefix: string) {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function getDefaultUser() {
  return users.find((user) => user.id === DEFAULT_USER_ID) ?? users[0];
}

export function toSummary(content: ContentDetail): ContentSummary {
  return {
    id: content.id,
    title: content.title,
    excerpt: content.excerpt,
    coverUrl: content.coverUrl,
    status: content.status,
    author: content.author,
    qualityScore: content.qualityScore,
    heatScore: content.heatScore,
    viewCount: content.viewCount,
    likeCount: content.likeCount,
    publishedAt: content.publishedAt,
    updatedAt: content.updatedAt
  };
}

export function attachAssets(content: ContentDetail): ContentDetail {
  const assetIds = contentAssets.get(content.id) ?? [];
  return {
    ...content,
    assets: assetIds.flatMap((assetId) => assets.find((asset) => asset.id === assetId) ?? [])
  };
}

export function createAuditRecord(contentId: string, audit: AuditResult, quality: QualityScoreResult) {
  const record: AuditRecord = {
    id: createId("audit"),
    contentId,
    audit,
    quality,
    checkedAt: now()
  };
  audits.unshift(record);
  return record;
}

export function createAiLog(input: Omit<AiCallLogRecord, "id" | "createdAt">) {
  const record: AiCallLogRecord = {
    id: createId("ai_log"),
    createdAt: now(),
    ...input
  };
  aiCallLogs.unshift(record);
  return record;
}

export function createAnalyticsEvent(input: Omit<AnalyticsEventRecord, "id" | "createdAt">) {
  const record: AnalyticsEventRecord = {
    id: createId("event"),
    createdAt: now(),
    ...input
  };
  analyticsEvents.unshift(record);
  return record;
}

export function makeGeneratedDraft(topic: string, style = "清爽、实用", materialNotes?: string): AiGenerateResult {
  const safeTopic = topic.trim() || "未命名选题";
  const materialLine = materialNotes ? `结合素材线索：${materialNotes}` : "结合已有素材与目标读者需求。";

  return {
    title: `${safeTopic}：一篇可以直接发布的短图文初稿`,
    body: `开头：围绕“${safeTopic}”给读者一个明确的问题场景，让内容从第一句话就有代入感。\n\n第一部分：用 ${style} 的表达方式交代核心观点，避免空泛描述。\n\n第二部分：拆成 3-5 个可执行步骤，每一步都给出具体做法和适用人群。\n\n第三部分：补充个人判断或避坑提醒，让内容不像模板堆砌。\n\n结尾：用一句行动建议收束，引导读者收藏、评论或尝试。\n\n${materialLine}`,
    tags: Array.from(new Set([safeTopic, "AI创作", "短图文"].map((tag) => tag.slice(0, 12)))),
    coverSuggestion: `封面建议突出“${safeTopic}”的核心视觉：主体清晰、背景干净，标题控制在 12 字以内。`
  };
}

export function buildAuditResult(title: string, body: string): AuditResult {
  const text = `${title}\n${body}`.toLowerCase();
  const riskWords = ["赌博", "博彩", "毒品", "色情", "隐私", "身份证", "低俗"];
  const hits = riskWords.filter((word) => text.includes(word.toLowerCase()));

  if (hits.length === 0) {
    return {
      passed: true,
      riskLevel: AuditRiskLevel.Low,
      riskTypes: ["none"],
      reasons: ["未发现高危合规风险。"],
      rewriteAvailable: false
    };
  }

  return {
    passed: false,
    riskLevel: hits.length > 1 ? AuditRiskLevel.High : AuditRiskLevel.Medium,
    riskTypes: hits.includes("隐私") || hits.includes("身份证") ? ["privacy"] : ["sensitive"],
    reasons: [`检测到可能违规或敏感表达：${hits.join("、")}。`],
    rewriteAvailable: true
  };
}

export function buildQualityScore(title: string, body: string): QualityScoreResult {
  const bodyLength = body.replace(/\s/g, "").length;
  const structure = body.includes("\n") ? 18 : 14;
  const clarity = Math.min(20, Math.max(12, Math.round(bodyLength / 60)));
  const value = body.includes("步骤") || body.includes("建议") || body.includes("提醒") ? 18 : 15;
  const attraction = title.length >= 8 && title.length <= 32 ? 18 : 14;
  const compliance = buildAuditResult(title, body).passed ? 19 : 10;
  const total = structure + clarity + value + attraction + compliance;

  return {
    total,
    dimensions: {
      structure,
      clarity,
      value,
      attraction,
      compliance
    },
    reason: total >= 85 ? "结构完整、表达清晰，适合进入审核发布流程。" : "内容可用，但建议继续补充结构、细节或合规表达。"
  };
}

export function touchContent(content: ContentDetail) {
  content.updatedAt = now();
  content.excerpt = content.body.slice(0, 72);
}
