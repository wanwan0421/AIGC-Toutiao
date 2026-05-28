export enum ContentStatus {
  Draft = "draft",
  PendingReview = "pending_review",
  Approved = "approved",
  Rejected = "rejected",
  Published = "published",
  Updated = "updated",
  Offline = "offline"
}

export enum PromptScene {
  Generate = "generate",
  Audit = "audit",
  Score = "score",
  Rewrite = "rewrite"
}

export enum AuditRiskLevel {
  Low = "low",
  Medium = "medium",
  High = "high"
}

export type AuditRiskType =
  | "pornography"
  | "gambling"
  | "drug"
  | "sensitive"
  | "vulgar"
  | "privacy"
  | "none";

export interface CreatorProfile {
  id: string;
  nickname: string;
  avatarUrl?: string;
}

export interface ContentSummary {
  id: string;
  title: string;
  excerpt: string;
  coverUrl?: string;
  status: ContentStatus;
  author: CreatorProfile;
  qualityScore: number;
  heatScore: number;
  viewCount: number;
  likeCount: number;
  publishedAt?: string;
  updatedAt: string;
}

export interface ContentDetail extends ContentSummary {
  body: string;
  tags: string[];
  assets: AssetSummary[];
}

export interface AssetSummary {
  id: string;
  fileName: string;
  mimeType: string;
  url: string;
  auditStatus: "pending" | "approved" | "rejected";
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface AiGenerateRequest {
  topic: string;
  style?: string;
  platform?: string;
  tags?: string[];
  promptTemplateId?: string;
  materialNotes?: string;
}

export interface AiGenerateResult {
  title: string;
  body: string;
  tags: string[];
  coverSuggestion: string;
}

export interface CreativeChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}

export interface CreativeConversationSummary {
  id: string;
  contentId?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messages: CreativeChatMessage[];
}

export interface GeneratedImageAsset extends AssetSummary {
  position: string;
  prompt: string;
}

export interface CreativeChatRequest {
  userId?: string;
  contentId?: string;
  conversationId?: string;
  message: string;
  currentTitle?: string;
  currentBody?: string;
  selectedText?: string;
}

export interface CreativeChatDone {
  conversationId: string;
  messageId: string;
}

export interface DirectGenerateRequest {
  userId?: string;
  contentId?: string;
  theme: string;
  audience?: string;
  style?: string;
  viewpoint?: string;
  materialNotes?: string;
  assets?: string[];
}

export interface DirectGenerateResult {
  title: string;
  titleCandidates: Array<{
    title: string;
    reason: string;
  }>;
  bodyMarkdown: string;
  tags: string[];
  coverSuggestion: string;
  imagePrompts: Array<{
    position: string;
    prompt: string;
  }>;
  coverAsset?: GeneratedImageAsset;
  imageAssets: GeneratedImageAsset[];
  outline: Array<{
    heading: string;
    summary: string;
  }>;
}

export interface TitleGenerateRequest {
  currentTitle?: string;
  body: string;
  platform?: string;
}

export interface TitleGenerateResult {
  candidates: Array<{
    title: string;
    reason: string;
  }>;
}

export interface SelectionRewriteRequest {
  selectedText: string;
  action: "polish" | "expand" | "tone";
  surroundingContext?: string;
  tone?: string;
}

export interface SelectionRewriteResult {
  replacement: string;
}

export interface AuditResult {
  passed: boolean;
  riskLevel: AuditRiskLevel;
  riskTypes: AuditRiskType[];
  reasons: string[];
  rewriteAvailable: boolean;
}

export interface QualityScoreResult {
  total: number;
  dimensions: {
    structure: number;
    clarity: number;
    value: number;
    attraction: number;
    compliance: number;
  };
  reason: string;
}

export interface RankingQuery {
  type: "hot" | "viral" | "recommended";
  cursor?: string;
  limit?: number;
}
