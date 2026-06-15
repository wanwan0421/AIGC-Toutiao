import type {
  AiJobEvent,
  AiJobSnapshot,
  AiJobStartRequest,
  AiJobType,
  CommentListResponse,
  ContentVisibility,
  ContentCommentSummary,
  ContentDetail,
  ContentReactionToggleResult,
  ContentSummary,
  ContentWorkflowState,
  CreateContentCommentRequest,
  CreativeChatDone,
  DashboardAnalyticsResponse,
  DashboardMetric,
  CreativeChatSkillEvent,
  CreativeConversationSummary,
  CreativeChatRequest,
  DirectGenerateRequest,
  AssetSummary,
  OfficialTopicListResponse,
  LocationSearchResponse,
  NearbyLocationsResponse,
  PromptDefinitionSummary,
  PromptEvalComparisonSummary,
  PromptEvalRunRequest,
  PromptEvalRunSummary,
  PromptRenderPreviewResult,
  PromptScene,
  PromptTestCaseSummary,
  PromptVersionSummary,
  RankingListResponse,
  RankingQuery,
  SelectionRewriteRequest,
  SelectionRewriteResult,
  TopicDetail,
  TitleGenerateRequest,
  TitleGenerateResult,
  UpdateUserProfileRequest,
  UserFollowToggleResult,
  UserContentListResponse,
  UserPublicProfileResponse,
  UserProfileSummary
} from "@aicp/shared";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

export type ContentVersionSummary = {
  id: string;
  contentId: string;
  version: number;
  title: string;
  body: string;
  bodyHtml?: string | null;
  bodyJson?: Record<string, unknown> | null;
  snapshot?: Record<string, unknown> | null;
  createdAt: string;
};

export type PromptTemplateSummary = {
  id: string;
  creatorId?: string | null;
  name: string;
  scene: PromptScene;
  template: string;
  variables?: unknown;
  model?: string | null;
  modelOptions?: unknown;
  outputSchema?: unknown;
  version: number;
  status: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

type AuthSessionResponse = {
  tokenType: string;
  expiresIn: number;
  user: UserProfileSummary;
};

let refreshAccessTokenPromise: Promise<AuthSessionResponse> | null = null;

function buildHeaders(initHeaders?: HeadersInit, body?: BodyInit | null) {
  const headers = new Headers(initHeaders);
  if (!(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

function resolveApiUrl(path: string) {
  if (/^https?:\/\//i.test(API_BASE_URL)) {
    return `${API_BASE_URL}${path}`;
  }

  if (typeof window === "undefined") {
    const serverApiOrigin = (process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001").replace(/\/$/, "");
    return `${serverApiOrigin}${API_BASE_URL}${path}`;
  }

  return `${API_BASE_URL}${path}`;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, needsAuth = false, allowRefresh = true, cacheMode: RequestCache = "default"): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    ...init,
    headers: buildHeaders(init.headers, init.body),
    credentials: "include",
    cache: cacheMode
  });

  if (response.status === 401 && needsAuth && allowRefresh && path !== "/auth/refresh") {
    try {
      await refreshAccessTokenOnce();
      return apiRequest<T>(path, init, needsAuth, false);
    } catch {
      // Surface the original 401 below.
    }
  }

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(payload.message) ? payload.message.join("; ") : payload.message ?? message;
    } catch {
      const text = await response.text().catch(() => "");
      if (text) message = text;
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function refreshAccessToken() {
  return apiRequest<AuthSessionResponse>("/auth/refresh", { method: "POST" }, false, false);
}

async function refreshAccessTokenOnce() {
  if (!refreshAccessTokenPromise) {
    refreshAccessTokenPromise = refreshAccessToken().finally(() => {
      refreshAccessTokenPromise = null;
    });
  }
  return refreshAccessTokenPromise;
}

export async function login(body: { account: string; password: string }) {
  return apiRequest<AuthSessionResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function register(body: { account: string; password: string; nickname?: string; verificationCode: string }) {
  return apiRequest<AuthSessionResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function sendVerificationCode(body: { account: string }) {
  return apiRequest<{ ok: boolean; delivery: "console" | "email" | "sms"; verificationCode?: string }>(
    "/auth/verification-code",
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
}

export async function sendContactVerificationCode(body: { account: string }) {
  return apiRequest<{ ok: boolean; delivery: "console" | "email" | "sms"; verificationCode?: string }>(
    "/users/contact-verification-code",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function logout() {
  return apiRequest<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

export async function me() {
  return apiRequest<UserProfileSummary>("/auth/me", {}, true);
}

export async function getUserProfile() {
  return apiRequest<UserProfileSummary>("/users/profile", {}, true);
}

export async function getCurrentUser() {
  return getUserProfile();
}

export async function updateUserProfile(body: UpdateUserProfileRequest) {
  return apiRequest<UserProfileSummary>(
    "/users/profile",
    {
      method: "PATCH",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function getContents(): Promise<ContentSummary[]> {
  return apiRequest<ContentSummary[]>("/contents", {}, true);
}

export async function getRankings(params: { type?: RankingQuery["type"]; cursor?: string; limit?: number } = {}): Promise<RankingListResponse> {
  const query = new URLSearchParams({
    type: params.type ?? "hot",
    limit: String(params.limit ?? 20),
  });
  if (params.cursor) query.set("cursor", params.cursor);
  return apiRequest<RankingListResponse>(`/rankings?${query.toString()}`);
}

export async function getOfficialTopics(params: number | { limit?: number; cursor?: string } = 8): Promise<OfficialTopicListResponse> {
  const options = typeof params === "number" ? { limit: params } : params;
  const query = new URLSearchParams({ limit: String(options.limit ?? 8) });
  if (options.cursor) query.set("cursor", options.cursor);
  return apiRequest<OfficialTopicListResponse>(`/rankings/topics?${query.toString()}`);
}

export async function getTopicDetail(title: string, limit = 30, cursor?: string): Promise<TopicDetail> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return apiRequest<TopicDetail>(`/rankings/topics/${encodeURIComponent(title)}?${query.toString()}`);
}

// 内容详情接口会包含用户的草稿信息，用户点击后就可以把之前的草稿内容恢复到编辑器中，避免用户在编辑过程中丢失之前的修改内容
export async function getContentDetail(id: string): Promise<ContentDetail> {
  return apiRequest<ContentDetail>(`/contents/${id}`, {}, true);
}

export async function getContentWorkflowState(id: string): Promise<ContentWorkflowState> {
  return apiRequest<ContentWorkflowState>(`/contents/${id}/workflow-state`, {}, true);
}

export async function getContentComments(id: string, params: { cursor?: string; limit?: number } = {}) {
  const query = new URLSearchParams({ limit: String(params.limit ?? 20) });
  if (params.cursor) query.set("cursor", params.cursor);
  return apiRequest<CommentListResponse>(`/contents/${id}/comments?${query.toString()}`, {}, true);
}

export async function createContentComment(id: string, body: CreateContentCommentRequest) {
  return apiRequest<ContentCommentSummary>(
    `/contents/${id}/comments`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    true
  );
}

export async function toggleContentReaction(id: string, type: "like" | "collect") {
  return apiRequest<ContentReactionToggleResult>(
    `/contents/${id}/reactions/${type}/toggle`,
    { method: "POST" },
    true
  );
}

export async function toggleUserFollow(id: string) {
  return apiRequest<UserFollowToggleResult>(`/users/${id}/follow/toggle`, { method: "POST" }, true);
}

export async function getUserPublicProfile(id: string) {
  return apiRequest<UserPublicProfileResponse>(`/users/${encodeURIComponent(id)}/public-profile`, {}, true);
}

export async function getUserContents(id: string) {
  return apiRequest<UserContentListResponse>(`/users/${encodeURIComponent(id)}/contents`, {}, true);
}

type ContentWriteBody = {
  title?: string;
  body?: string;
  bodyHtml?: string | null;
  bodyJson?: Record<string, unknown> | null;
  tags?: string[];
  assetIds?: string[];
  visibility?: ContentVisibility;
  scheduledAt?: string | null;
};

export async function createContent(body: ContentWriteBody) {
  return apiRequest<ContentDetail>(
    "/contents",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function updateContent(id: string, body: ContentWriteBody) {
  return apiRequest<ContentDetail>(
    `/contents/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function deleteContent(id: string) {
  return apiRequest<{ ok: boolean; id: string }>(`/contents/${id}`, { method: "DELETE" }, true);
}

export async function publishContent(id: string, body: { scheduledAt?: string | null; visibility?: ContentVisibility } = {}) {
  return apiRequest<ContentSummary>(
    `/contents/${id}/publish`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    true
  );
}

export async function updateContentVisibility(id: string, visibility: ContentVisibility) {
  return apiRequest<ContentSummary>(
    `/contents/${id}/visibility`,
    {
      method: "PATCH",
      body: JSON.stringify({ visibility }),
    },
    true
  );
}

export async function offlineContent(id: string) {
  return apiRequest<ContentSummary>(`/contents/${id}/offline`, { method: "POST" }, true);
}

export async function getContentVersions(id: string) {
  return apiRequest<ContentVersionSummary[]>(`/contents/${id}/versions`, {}, true);
}

export async function rollbackContentVersion(id: string, version: number) {
  return apiRequest<ContentDetail>(`/contents/${id}/versions/${version}/rollback`, { method: "POST" }, true);
}

export async function getAssets(contentId?: string) {
  const query = contentId ? `?contentId=${encodeURIComponent(contentId)}` : "";
  return apiRequest<AssetSummary[]>(`/assets${query}`, {}, true);
}

export async function uploadAsset(body: { file: File; contentId?: string }) {
  const formData = new FormData();
  formData.append("file", body.file);
  if (body.contentId) {
    formData.append("contentId", body.contentId);
  }

  return apiRequest<AssetSummary>(
    "/assets/upload",
    {
      method: "POST",
      body: formData,
    },
    true
  );
}

export async function deleteAsset(id: string) {
  return apiRequest<{ ok: boolean; id: string }>(`/assets/${encodeURIComponent(id)}/delete`, { method: "POST" }, true);
}

export async function linkAssetToContent(assetId: string, contentId: string) {
  return apiRequest<{ ok: boolean; contentId: string; asset: AssetSummary }>(
    `/assets/${assetId}/link/${contentId}`,
    { method: "POST" },
    true
  );
}

export async function getPrompts(scene?: PromptScene) {
  const query = scene ? `?scene=${encodeURIComponent(scene)}` : "";
  return apiRequest<PromptTemplateSummary[]>(`/prompts${query}`, {}, true);
}

export async function createPrompt(body: {
  name: string;
  scene: PromptScene;
  template: string;
  variables?: string[];
  model?: string;
  modelOptions?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  description?: string;
  changeNote?: string;
}) {
  return apiRequest<PromptTemplateSummary>(
    "/prompts",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    true
  );
}

export async function updatePrompt(
  id: string,
  body: Partial<{
    name: string;
    scene: PromptScene;
    template: string;
    variables: string[];
    model: string;
    modelOptions: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    description: string;
    changeNote: string;
    status: "active" | "draft" | "disabled";
  }>
) {
  return apiRequest<PromptTemplateSummary>(
    `/prompts/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
    true
  );
}

export async function getDraft(contentId: string) {
  return apiRequest<{
    id?: string;
    contentId: string;
    authorId: string;
    title?: string;
    body?: string;
    payload?: {
      html?: string;
      json?: Record<string, unknown>;
      coverPreview?: string;
      tags?: string[];
      [key: string]: unknown;
    };
    clientHash?: string;
    savedAt: string;
    source: string;
  }>(`/drafts/${contentId}`, {}, true);
}

export async function autosaveDraft(
  contentId: string,
  body: { title?: string; body?: string; payload?: Record<string, unknown>; clientHash?: string }
) {
  return apiRequest<Record<string, unknown>>(
    `/drafts/${contentId}/autosave`,
    {
      method: "PUT",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function startAiJob(body: AiJobStartRequest) {
  return apiRequest<AiJobSnapshot>(
    "/ai/jobs",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function getAiJob(id: string) {
  return apiRequest<AiJobSnapshot>(`/ai/jobs/${encodeURIComponent(id)}`, {}, true);
}

export async function cancelAiJob(id: string) {
  return apiRequest<AiJobSnapshot>(`/ai/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }, true);
}

export async function startCreativeDraftJob(body: DirectGenerateRequest) {
  return apiRequest<AiJobSnapshot>(
    "/ai/creative/direct-generate/jobs",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function startCreativeImageJob(body: { contentId?: string; position?: string; prompt: string }) {
  return apiRequest<AiJobSnapshot>(
    "/ai/creative/image/jobs",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function startSubmitReviewJob(id: string) {
  return apiRequest<AiJobSnapshot>(`/contents/${id}/submit-review/jobs`, { method: "POST" }, true);
}

export async function startApproveContentJob(id: string) {
  return startQualityScoreJob(id);
}

export async function startQualityScoreJob(id: string) {
  return apiRequest<AiJobSnapshot>(`/contents/${id}/quality-score/jobs`, { method: "POST" }, true);
}

export async function startModerationRunJob(contentId: string) {
  return apiRequest<AiJobSnapshot>(`/moderation/contents/${contentId}/run/jobs`, { method: "POST" }, true);
}

export async function startComplianceRewriteJob(body: { title: string; body: string; reasons?: string[] }) {
  return startAiJob({
    type: "compliance_rewrite" as AiJobType,
    payload: body
  });
}

export async function generateCreativeTitles(body: TitleGenerateRequest) {
  return apiRequest<TitleGenerateResult>(
    "/ai/creative/titles",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function rewriteSelection(body: SelectionRewriteRequest) {
  return apiRequest<SelectionRewriteResult>(
    "/ai/creative/selection/rewrite",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function getCreativeImageConfigStatus() {
  return apiRequest<{
    configured: boolean;
    provider: string;
    apiUrl: string;
    model: string | null;
    imageSize: string;
    hasApiKey: boolean;
    missing: string[];
  }>("/ai/creative/image/config", {}, true);
}

export async function streamCreativeChat(
  body: CreativeChatRequest,
  handlers: {
    onMeta?: (event: CreativeChatDone) => void;
    onDelta: (text: string) => void;
    onDone?: (event: CreativeChatDone) => void;
    onSkill?: (event: CreativeChatSkillEvent) => void;
    onError?: (message: string) => void;
  }
) {
  return streamCreativeChatOnce(body, handlers, true);
}

export async function streamAiJobEvents(
  jobId: string,
  handlers: {
    onEvent?: (event: AiJobEvent) => void;
    onSnapshot?: (job: AiJobSnapshot) => void;
    onProgress?: (data: Record<string, unknown>) => void;
    onPartial?: (data: Record<string, unknown>) => void;
    onWarning?: (message: string, data: Record<string, unknown>) => void;
    onDone?: (job: AiJobSnapshot, result: unknown) => void;
    onError?: (message: string, job?: AiJobSnapshot) => void;
  },
  signal?: AbortSignal
) {
  return streamAiJobEventsOnce(jobId, handlers, signal, true);
}

async function streamAiJobEventsOnce(
  jobId: string,
  handlers: {
    onEvent?: (event: AiJobEvent) => void;
    onSnapshot?: (job: AiJobSnapshot) => void;
    onProgress?: (data: Record<string, unknown>) => void;
    onPartial?: (data: Record<string, unknown>) => void;
    onWarning?: (message: string, data: Record<string, unknown>) => void;
    onDone?: (job: AiJobSnapshot, result: unknown) => void;
    onError?: (message: string, job?: AiJobSnapshot) => void;
  },
  signal: AbortSignal | undefined,
  allowRefresh: boolean
) {
  const response = await fetch(resolveApiUrl(`/ai/jobs/${encodeURIComponent(jobId)}/events`), {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    signal
  });

  if (response.status === 401 && allowRefresh) {
    await refreshAccessTokenOnce();
    return streamAiJobEventsOnce(jobId, handlers, signal, false);
  }

  if (!response.ok || !response.body) {
    throw new Error(`AI 任务流连接失败：${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventBlock of events) {
      const event = parseSseEvent(eventBlock) as AiJobEvent | null;
      if (!event) continue;
      handlers.onEvent?.(event);
      const data = event.data ?? {};
      const job = data.job as AiJobSnapshot | undefined;

      if (event.type === "snapshot" && job) {
        handlers.onSnapshot?.(job);
      } else if (event.type === "progress") {
        handlers.onProgress?.(data);
      } else if (event.type === "partial") {
        handlers.onPartial?.(data);
      } else if (event.type === "warning") {
        handlers.onWarning?.(typeof data.message === "string" ? data.message : "AI 任务出现非致命问题", data);
      } else if (event.type === "done" && job) {
        handlers.onDone?.(job, data.result);
      } else if (event.type === "error") {
        handlers.onError?.(typeof data.message === "string" ? data.message : "AI 任务失败", job);
      }
    }
  }
}

async function streamCreativeChatOnce(
  body: CreativeChatRequest,
  handlers: {
    onMeta?: (event: CreativeChatDone) => void;
    onDelta: (text: string) => void;
    onDone?: (event: CreativeChatDone) => void;
    onSkill?: (event: CreativeChatSkillEvent) => void;
    onError?: (message: string) => void;
  },
  allowRefresh: boolean
) {
  const response = await fetch(resolveApiUrl("/ai/creative/chat/stream"), {
    method: "POST",
    headers: buildHeaders(),
    credentials: "include",
    body: JSON.stringify(body)
  });

  if (response.status === 401 && allowRefresh) {
    await refreshAccessTokenOnce();
    return streamCreativeChatOnce(body, handlers, false);
  }

  if (!response.ok || !response.body) {
    throw new Error(`Creative chat stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventBlock of events) {
      const event = parseSseEvent(eventBlock);
      if (!event) continue;

      if (event.type === "delta") {
        handlers.onDelta((event.data as { text?: string }).text ?? "");
      } else if (event.type === "meta") {
        handlers.onMeta?.(event.data as CreativeChatDone);
      } else if (event.type === "done") {
        handlers.onDone?.(event.data as CreativeChatDone);
      } else if (event.type === "skill") {
        handlers.onSkill?.(event.data as CreativeChatSkillEvent);
      } else if (event.type === "error") {
        handlers.onError?.((event.data as { message?: string }).message ?? "AI 对话流失败");
      }
    }
  }
}

export async function getCreativeConversations(contentId: string) {
  return apiRequest<CreativeConversationSummary[]>(
    `/ai/creative/conversations?contentId=${encodeURIComponent(contentId)}`,
    {},
    true
  );
}

// 将 conversation 关联到内容上，主要用于用户在编辑过程中进行了聊天交互但还没有保存草稿的场景，此时会先创建一个内容记录，然后把之前的 conversation 关联到这个内容上，避免用户在编辑过程中丢失之前的聊天记录
export async function attachCreativeConversation(conversationId: string, contentId: string) {
  return apiRequest<{ ok: boolean; conversationId: string; contentId: string }>(
    `/ai/creative/conversations/${conversationId}/attach`,
    {
      method: "PATCH",
      body: JSON.stringify({ contentId })
    },
    true
  );
}

function parseSseEvent(block: string) {
  const lines = block.split("\n");
  const type = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
  const dataLine = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
  if (!type || !dataLine) return null;

  try {
    return { type, data: JSON.parse(dataLine) as unknown };
  } catch {
    return null;
  }
}

export async function trackAnalytics(body: {
  contentId: string;
  eventType: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}) {
  return apiRequest<{
    ok: boolean;
    sink: string;
    counters: {
      viewCount: number;
      likeCount: number;
      collectCount: number;
      clickCount: number;
      heatScore: number;
    };
  }>(
    "/analytics/events",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function getContentStats(contentId: string) {
  return apiRequest<{
    contentId: string;
    counters: {
      viewCount: number;
      likeCount: number;
      collectCount: number;
      clickCount: number;
      heatScore: number;
    };
    redisCounters: Record<string, string>;
  }>(`/analytics/contents/${contentId}`, {}, true);
}

export async function postNearbyLocations(body: { latitude: number; longitude: number }) {
  return apiRequest<NearbyLocationsResponse>(
    "/locations/nearby",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function getDashboardAnalytics(params: { range?: 7 | 30; metric?: DashboardMetric } = {}) {
  const query = new URLSearchParams({
    range: String(params.range ?? 7),
    metric: params.metric ?? "view",
  });
  return apiRequest<DashboardAnalyticsResponse>(`/analytics/dashboard?${query.toString()}`, {}, true);
}

export async function getPromptDefinitions(scene?: PromptScene) {
  const query = scene ? `?scene=${encodeURIComponent(scene)}` : "";
  return apiRequest<PromptDefinitionSummary[]>(`/prompts/definitions${query}`, {}, true, true, "no-store");
}

export async function getPromptVersions(key: string) {
  return apiRequest<PromptVersionSummary[]>(`/prompts/${encodeURIComponent(key)}/versions`, {}, true);
}

export async function createPromptVersion(
  key: string,
  body: {
    template: string;
    variables?: string[];
    model?: string;
    modelOptions?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    changeNote?: string;
    status?: "active" | "draft" | "disabled";
  }
) {
  return apiRequest<PromptVersionSummary>(
    `/prompts/${encodeURIComponent(key)}/versions`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    true
  );
}

export async function activatePromptVersion(key: string, versionId: string) {
  return apiRequest<PromptDefinitionSummary>(
    `/prompts/${encodeURIComponent(key)}/versions/${encodeURIComponent(versionId)}/activate`,
    { method: "POST" },
    true
  );
}

export async function renderPromptPreview(
  key: string,
  body: {
    input?: Record<string, unknown>;
    template?: string;
    variables?: string[];
    model?: string;
    modelOptions?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }
) {
  return apiRequest<PromptRenderPreviewResult>(
    `/prompts/${encodeURIComponent(key)}/render-preview`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    true
  );
}

export async function getPromptTestCases(key: string) {
  return apiRequest<PromptTestCaseSummary[]>(`/prompts/${encodeURIComponent(key)}/test-cases`, {}, true);
}

export async function createPromptTestCase(
  key: string,
  body: {
    name: string;
    input: Record<string, unknown>;
    expectedOutput?: unknown;
    assertions?: Record<string, unknown>;
    enabled?: boolean;
  }
) {
  return apiRequest<PromptTestCaseSummary>(
    `/prompts/${encodeURIComponent(key)}/test-cases`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    true
  );
}

export async function updatePromptTestCase(
  key: string,
  caseId: string,
  body: Partial<{
    name: string;
    input: Record<string, unknown>;
    expectedOutput: unknown;
    assertions: Record<string, unknown>;
    enabled: boolean;
  }>
) {
  return apiRequest<PromptTestCaseSummary>(
    `/prompts/${encodeURIComponent(key)}/test-cases/${encodeURIComponent(caseId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
    true
  );
}

export async function deletePromptTestCase(key: string, caseId: string) {
  return apiRequest<{ ok: boolean; id: string }>(
    `/prompts/${encodeURIComponent(key)}/test-cases/${encodeURIComponent(caseId)}`,
    { method: "DELETE" },
    true
  );
}

export async function runPromptEval(
  key: string,
  body: PromptEvalRunRequest = {}
) {
  return apiRequest<PromptEvalRunSummary>(
    `/prompts/${encodeURIComponent(key)}/eval-runs`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    true
  );
}

export async function comparePromptEvalRuns(key: string, baselineRunId: string, candidateRunId: string) {
  const query = new URLSearchParams({ baselineRunId, candidateRunId });
  return apiRequest<PromptEvalComparisonSummary>(
    `/prompts/${encodeURIComponent(key)}/eval-runs/compare?${query.toString()}`,
    {},
    true
  );
}

export async function getPromptEvalRun(key: string, runId: string) {
  return apiRequest<PromptEvalRunSummary>(
    `/prompts/${encodeURIComponent(key)}/eval-runs/${encodeURIComponent(runId)}`,
    {},
    true
  );
}

export async function searchLocations(keyword: string) {
  return apiRequest<LocationSearchResponse>(
    `/locations/search?keyword=${encodeURIComponent(keyword)}`,
    {},
    true
  );
}
