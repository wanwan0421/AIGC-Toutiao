export enum ContentStatus {
  Draft = "draft",
  PendingReview = "pending_review",
  Approved = "approved",
  Rejected = "rejected",
  Scheduled = "scheduled",
  Published = "published",
  Updated = "updated",
  Offline = "offline"
}

export type ContentVisibility = "public" | "followers" | "private";
export type DashboardMetric = "view" | "click" | "like" | "collect" | "comment" | "heat";

export enum PromptScene {
  Generate = "generate",
  Audit = "audit",
  Score = "score",
  Rewrite = "rewrite"
}

export type PromptStatus = "active" | "draft" | "disabled" | "archived";
export type PromptValidationSeverity = "info" | "warning" | "error";

export interface PromptValidationIssue {
  type: "missing_variable" | "unused_variable" | "undeclared_variable" | "empty_variable" | "duplicate_variable";
  severity: PromptValidationSeverity;
  variable?: string;
  message: string;
}

export interface PromptVersionSummary {
  id: string;
  definitionId: string;
  version: number;
  template: string;
  variables: string[];
  model?: string | null;
  modelOptions?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  changeNote?: string | null;
  status: string;
  createdAt: string;
}

export interface PromptDefinitionSummary {
  id: string;
  key: string;
  scene: PromptScene;
  displayName: string;
  description?: string | null;
  status: string;
  usageCount: number;
  activeVersionId?: string | null;
  activeVersion?: PromptVersionSummary | null;
  updatedAt: string;
  createdAt: string;
}

export interface PromptRenderPreviewResult {
  prompt: string;
  variables: string[];
  declaredVariables: string[];
  inputKeys: string[];
  issues: PromptValidationIssue[];
  model?: string | null;
  modelOptions?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
}

export interface PromptTestCaseSummary {
  id: string;
  definitionId: string;
  name: string;
  input: Record<string, unknown>;
  expectedOutput?: unknown;
  assertions?: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptEvalResultSummary {
  id: string;
  runId: string;
  testCaseId?: string | null;
  status: string;
  input: Record<string, unknown>;
  output?: unknown;
  renderedPrompt?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  createdAt: string;
}

export interface PromptEvalRunSummary {
  id: string;
  definitionId: string;
  versionId?: string | null;
  mode: string;
  status: string;
  total: number;
  passed: number;
  failed: number;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
  results?: PromptEvalResultSummary[];
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
  accountNo?: number;
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
  accountNo?: number;
  account?: string;
  email?: string;
  phone?: string;
  nickname: string;
  bio?: string;
  avatarUrl?: string;
  followerCount?: number;
  followingCount?: number;
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
  visibility: ContentVisibility;
  author: CreatorProfile;
  qualityScore: number;
  heatScore: number;
  viewCount: number;
  likeCount: number;
  collectCount: number;
  commentCount?: number;
  createdAt?: string;
  publishedAt?: string;
  scheduledAt?: string;
  updatedAt: string;
}

export interface ContentDetail extends ContentSummary {
  body: string;
  bodyHtml?: string | null;
  bodyJson?: Record<string, unknown> | null;
  tags: string[];
  assets: AssetSummary[];
  viewerState?: ContentViewerState;
}

export interface ContentViewerState {
  liked: boolean;
  collected: boolean;
  followingAuthor: boolean;
  isAuthor: boolean;
}

export interface ContentReactionToggleResult {
  contentId: string;
  type: "like" | "collect";
  active: boolean;
  likeCount: number;
  collectCount: number;
  heatScore: number;
}

export interface ContentCommentSummary {
  id: string;
  contentId: string;
  body: string;
  author: CreatorProfile;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContentCommentRequest {
  body: string;
}

export interface CommentListResponse {
  items: ContentCommentSummary[];
  nextCursor?: string;
}

export interface UserFollowToggleResult {
  userId: string;
  following: boolean;
  followingCount: number;
  followerCount: number;
}

export interface UserPublicProfile {
  id: string;
  accountNo?: number;
  nickname: string;
  bio?: string;
  avatarUrl?: string;
  followerCount: number;
  followingCount: number;
  contentCount: number;
  createdAt?: string;
}

export interface UserPublicProfileResponse {
  profile: UserPublicProfile;
  viewerState: {
    following: boolean;
    isSelf: boolean;
  };
}

export interface UserContentListResponse {
  items: ContentSummary[];
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
  nextCursor?: string;
}

export interface RankingListResponse {
  items: ContentSummary[];
  nextCursor?: string;
}

export interface OfficialTopicListResponse {
  items: OfficialTopicSummary[];
  nextCursor?: string;
}

export interface AssetSummary {
  id: string;
  fileName: string;
  mimeType: string;
  url: string;
  auditStatus: "pending" | "approved" | "rejected";
  auditReason?: string;
  riskLevel?: "unknown" | "low" | "medium" | "high";
  riskTypes?: string[];
  createdAt?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardTrendPoint {
  date: string;
  label: string;
  view: number;
  click: number;
  like: number;
  collect: number;
  comment: number;
  heat: number;
}

export interface DashboardMetricOverview {
  metric: DashboardMetric;
  label: string;
  total: number;
  delta: number;
}

export interface DashboardAnalyticsResponse {
  range: 7 | 30;
  metric: DashboardMetric;
  period: {
    start: string;
    end: string;
  };
  latestWork?: ContentSummary;
  metrics: Record<DashboardMetric, DashboardMetricOverview>;
  trend: DashboardTrendPoint[];
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

export type AiSkillKey = "content-production-line" | "content-safety-reviewer";
export type CreativeChatAction = "chat" | "run_skill" | "edit_current_content" | "ask_clarification";

export interface ContentEditPatch {
  target: string;
  mode: "replace_selection" | "replace_section" | "append_after_section" | "preview";
  replacementMarkdown: string;
  confidence: number;
  needsConfirmation: boolean;
}

export type CreativeChatSkillEventType =
  | "skill_started"
  | "job_started"
  | "job_progress"
  | "job_partial"
  | "job_done"
  | "inline_result"
  | "skill_error";

export interface CreativeChatSkillEvent {
  type: CreativeChatSkillEventType;
  skillKey: AiSkillKey;
  message?: string;
  job?: AiJobSnapshot;
  result?: unknown;
  data?: Record<string, unknown>;
}

export interface GeneratedImageCandidate {
  asset: GeneratedImageAsset;
  role: "cover" | "inline";
  operationId: string;
  inserted: false;
  position?: string;
  prompt?: string;
  fallbackReason?: string;
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

export interface ContentWorkflowAuditState {
  content: ContentSummary;
  audit: AuditResult;
  rewrite?: ComplianceRewriteResult | null;
  checkedAt: string;
}

export interface ContentWorkflowQualityState extends QualityScoreResult {
  scoredAt: string;
}

export interface ContentWorkflowState {
  content: ContentSummary;
  latestAudit?: ContentWorkflowAuditState;
  latestQuality?: ContentWorkflowQualityState;
  canPublish: boolean;
  publishBlockReason?: string;
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
  limit?: number | string;
}
