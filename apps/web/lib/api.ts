import type {
  AiGenerateRequest,
  AiGenerateResult,
  AuditResult,
  ContentDetail,
  ContentSummary,
  CreativeChatDone,
  CreativeConversationSummary,
  CreativeChatRequest,
  DirectGenerateRequest,
  DirectGenerateResult,
  QualityScoreResult,
  SelectionRewriteRequest,
  SelectionRewriteResult,
  TitleGenerateRequest,
  TitleGenerateResult,
  UpdateUserProfileRequest,
  UserProfileSummary
} from "@aicp/shared";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

type AuthSessionResponse = {
  tokenType: string;
  expiresIn: number;
  user: UserProfileSummary;
};

function buildHeaders(initHeaders?: HeadersInit) {
  const headers = new Headers(initHeaders);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

function resolveApiUrl(path: string) {
  if (/^https?:\/\//i.test(API_BASE_URL)) {
    return `${API_BASE_URL}${path}`;
  }

  if (typeof window === "undefined") {
    const serverApiOrigin = (process.env.API_PROXY_TARGET ?? "http://localhost:3001").replace(/\/$/, "");
    return `${serverApiOrigin}${API_BASE_URL}${path}`;
  }

  return `${API_BASE_URL}${path}`;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, needsAuth = false, allowRefresh = true): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    ...init,
    headers: buildHeaders(init.headers),
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

export async function getContentDetail(id: string): Promise<ContentDetail> {
  return apiRequest<ContentDetail>(`/contents/${id}`, {}, true);
}

export async function createContent(body: { title?: string; body?: string; tags?: string[]; assetIds?: string[] }) {
  return apiRequest<ContentDetail>(
    "/contents",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function updateContent(id: string, body: { title?: string; body?: string; tags?: string[]; assetIds?: string[] }) {
  return apiRequest<ContentDetail>(
    `/contents/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function submitReview(id: string) {
  return apiRequest<{ content: ContentSummary; audit: AuditResult; quality: QualityScoreResult }>(
    `/contents/${id}/submit-review`,
    { method: "POST" },
    true
  );
}

export async function approveContent(id: string) {
  return apiRequest<ContentSummary>(`/contents/${id}/approve`, { method: "POST" }, true);
}

export async function publishContent(id: string) {
  return apiRequest<ContentSummary>(`/contents/${id}/publish`, { method: "POST" }, true);
}

export async function offlineContent(id: string) {
  return apiRequest<ContentSummary>(`/contents/${id}/offline`, { method: "POST" }, true);
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

export async function generateDraft(body: AiGenerateRequest & { audience?: string }) {
  return apiRequest<AiGenerateResult>(
    "/ai/generate",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function generateCreativeDraft(body: DirectGenerateRequest) {
  return apiRequest<DirectGenerateResult>(
    "/ai/creative/direct-generate",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
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

export async function auditText(body: { title: string; body: string }) {
  return apiRequest<AuditResult>(
    "/ai/audit",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function scoreText(body: { title: string; body: string }) {
  return apiRequest<QualityScoreResult>(
    "/ai/score",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
}

export async function rewriteText(body: { title: string; body: string; reasons?: string[] }) {
  return apiRequest<{ title: string; body: string; reasons: string[] }>(
    "/ai/rewrite",
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    true
  );
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
