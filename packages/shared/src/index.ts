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

export enum AiJobStatus {
  Queued = "queued",
  Running = "running",
  Succeeded = "succeeded",
  Failed = "failed",
  Cancelled = "cancelled"
}

export enum AiJobType {
  CreativeDirectGenerate = "creative_direct_generate",
  CreativeImageGenerate = "creative_image_generate",
  ContentSubmitReview = "content_submit_review",
  ContentApprove = "content_approve",
  ModerationContentRun = "moderation_content_run",
  ComplianceRewrite = "compliance_rewrite"
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
  | "illegal"
  | "fraud"
  | "minor"
  | "none";

export type AuditRiskSeverity = "low" | "medium" | "high";
export type AuditRiskSource = "rule" | "llm" | "merged";
export type AuditRiskField = "title" | "body";

export interface AuditRiskItem {
  id: string;
  type: AuditRiskType;
  severity: AuditRiskSeverity;
  confidence: number;
  evidence: string;
  reason: string;
  source: AuditRiskSource;
  field?: AuditRiskField;
  startOffset?: number;
  endOffset?: number;
  ruleId?: string;
  suggestion?: string;
}

export type AuditCategoryScores = Partial<Record<Exclude<AuditRiskType, "none">, number>>;

export interface CreatorProfile {
  id: string;
  nickname: string;
  avatarUrl?: string;
}

export interface UserPreferenceSummary {
  writingStyles: string[];
  domains: string[];
  blockedWords: string[];
}

export interface UserProfileSummary {
  id: string;
  account?: string;
  email?: string;
  phone?: string;
  nickname: string;
  bio?: string;
  avatarUrl?: string;
  preferences: UserPreferenceSummary;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateUserProfileRequest {
  nickname?: string;
  bio?: string;
  avatarUrl?: string;
  email?: string;
  phone?: string;
  contactVerificationCode?: string;
  blockedWords?: string[];
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
  collectCount: number;
  publishedAt?: string;
  updatedAt: string;
}

export interface ContentDetail extends ContentSummary {
  body: string;
  bodyHtml?: string | null;
  bodyJson?: Record<string, unknown> | null;
  tags: string[];
  assets: AssetSummary[];
}

export interface OfficialTopicSummary {
  id: string;
  title: string;
  description: string;
  category: string;
  heatScore: number;
  contentCount: number;
  coverUrl?: string;
}

export interface TopicDetail {
  topic: OfficialTopicSummary;
  items: ContentSummary[];
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

export interface LocationCandidate {
  id: string;
  name: string;
  address: string;
  type: string;
  distance?: number;
  latitude?: number;
  longitude?: number;
  source: "amap";
}

export interface NearbyLocationsResponse {
  formattedAddress: string;
  city?: string;
  district?: string;
  candidates: LocationCandidate[];
}

export interface LocationSearchResponse {
  candidates: LocationCandidate[];
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

export interface ComplianceRewriteResult {
  title: string;
  body: string;
  reasons: string[];
  replacements?: ComplianceReplacement[];
}

export interface ComplianceReplacement {
  riskItemId: string;
  original: string;
  replacement: string;
  reason: string;
}

export interface AuditResult {
  passed: boolean;
  riskLevel: AuditRiskLevel;
  riskTypes: AuditRiskType[];
  reasons: string[];
  rewriteAvailable: boolean;
  riskItems: AuditRiskItem[];
  categoryScores?: AuditCategoryScores;
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

export interface ContentApprovalResult {
  content: ContentSummary;
  quality: QualityScoreResult;
}

export type AiJobEventType =
  | "snapshot"
  | "progress"
  | "partial"
  | "warning"
  | "heartbeat"
  | "done"
  | "error";

export interface AiJobSnapshot {
  id: string;
  type: AiJobType;
  status: AiJobStatus;
  contentId?: string | null;
  progress: number;
  currentStep?: string | null;
  input?: Record<string, unknown>;
  result?: unknown;
  errorMessage?: string | null;
  warnings: string[];
  attempts: number;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiJobStartRequest {
  type: AiJobType;
  payload: Record<string, unknown>;
  contentId?: string;
}

export interface AiJobEvent {
  type: AiJobEventType;
  data: Record<string, unknown>;
}

export interface RankingQuery {
  type: "hot" | "viral" | "recommended";
  cursor?: string;
  limit?: number;
}
