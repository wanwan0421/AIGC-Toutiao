import type {
  AiJobEvent,
  AiJobSnapshot,
  AiJobStartRequest,
  AiJobType,
  ContentDetail,
  ContentSummary,
  CreativeChatDone,
  CreativeConversationSummary,
  CreativeChatRequest,
  DirectGenerateRequest,
  AssetSummary,
  OfficialTopicSummary,
  PromptScene,
  SelectionRewriteRequest,
  SelectionRewriteResult,
  TopicDetail,
  TitleGenerateRequest,
  TitleGenerateResult,
  UpdateUserProfileRequest,
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

export async function apiRequest<T>(path: string, init: RequestInit = {}, needsAuth = false, allowRefresh = true): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    ...init,
    headers: buildHeaders(init.headers, init.body),
    credentials: "include",
    cache: "no-store"
  });

  if (response.status === 401 && needsAuth && allowRefresh && path !== "/auth/refresh") {
    try {
      await refreshAccessToken();
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

export async function getRankings(): Promise<ContentSummary[]> {
  const response = await apiRequest<{ items: ContentSummary[] }>("/rankings?type=hot&limit=20");
  return response.items;
}

export async function getOfficialTopics(limit = 8): Promise<OfficialTopicSummary[]> {
  const response = await apiRequest<{ items: OfficialTopicSummary[] }>(`/rankings/topics?limit=${limit}`);
  return response.items;
}

export async function getTopicDetail(title: string, limit = 30): Promise<TopicDetail> {
  return apiRequest<TopicDetail>(`/rankings/topics/${encodeURIComponent(title)}?limit=${limit}`);
}

// 内容详情接口会包含用户的草稿信息，用户点击后就可以把之前的草稿内容恢复到编辑器中，避免用户在编辑过程中丢失之前的修改内容
export async function getContentDetail(id: string): Promise<ContentDetail> {
  return apiRequest<ContentDetail>(`/contents/${id}`, {}, true);
}

type ContentWriteBody = {
  title?: string;
  body?: string;
  bodyHtml?: string | null;
  bodyJson?: Record<string, unknown> | null;
  tags?: string[];
  assetIds?: string[];
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

export async function publishContent(id: string) {
  return apiRequest<ContentSummary>(`/contents/${id}/publish`, { method: "POST" }, true);
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
    template: string;
    variables: string[];
    model: string;
    modelOptions: Record<string, unknown>;
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
  return apiRequest<AiJobSnapshot>(`/contents/${id}/approve/jobs`, { method: "POST" }, true);
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
    await refreshAccessToken();
    return streamAiJobEventsOnce(jobId, handlers, signal, false);
  }

  if (!response.ok || !response.body) {
    throw new Error(`AI job stream failed: ${response.status}`);
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
    await refreshAccessToken();
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
      } else if (event.type === "error") {
        handlers.onError?.((event.data as { message?: string }).message ?? "AI stream failed");
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
