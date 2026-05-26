import type {
  AiGenerateRequest,
  AiGenerateResult,
  AuditResult,
  ContentDetail,
  ContentSummary,
  QualityScoreResult
} from "@aicp/shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

const AUTH_TOKEN_KEY = "aicp.accessToken";

function getStoredAccessToken() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage.getItem(AUTH_TOKEN_KEY) ?? undefined;
}

function buildHeaders(initHeaders?: HeadersInit, needsAuth = false) {
  const headers = new Headers(initHeaders);

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (needsAuth) {
    const token = getStoredAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  return headers;
}

async function apiRequest<T>(path: string, init: RequestInit = {}, needsAuth = false): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: buildHeaders(init.headers, needsAuth),
    cache: "no-store"
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;

    try {
      const payload = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(payload.message)) {
        message = payload.message.join("; ");
      } else if (typeof payload.message === "string") {
        message = payload.message;
      }
    } catch {
      const text = await response.text().catch(() => "");
      if (text) {
        message = text;
      }
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function getContents(): Promise<ContentSummary[]> {
  return apiRequest<ContentSummary[]>("/contents");
}

export async function getRankings(): Promise<ContentSummary[]> {
  const response = await apiRequest<{ items: ContentSummary[] }>("/rankings?type=hot&limit=20");
  return response.items;
}

export async function getContentDetail(id: string): Promise<ContentDetail> {
  return apiRequest<ContentDetail>(`/contents/${id}`);
}

export async function createContent(body: { title?: string; body?: string; tags?: string[]; assetIds?: string[] }) {
  return apiRequest<ContentDetail>("/contents", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function updateContent(
  id: string,
  body: { title?: string; body?: string; tags?: string[]; assetIds?: string[] }
) {
  return apiRequest<ContentDetail>(`/contents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export async function submitReview(id: string) {
  return apiRequest<{
    content: ContentSummary;
    audit: AuditResult;
    quality: QualityScoreResult;
  }>(`/contents/${id}/submit-review`, {
    method: "POST"
  });
}

export async function approveContent(id: string) {
  return apiRequest<ContentSummary>(`/contents/${id}/approve`, {
    method: "POST"
  });
}

export async function publishContent(id: string) {
  return apiRequest<ContentSummary>(`/contents/${id}/publish`, {
    method: "POST"
  });
}

export async function offlineContent(id: string) {
  return apiRequest<ContentSummary>(`/contents/${id}/offline`, {
    method: "POST"
  });
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
  }>(`/drafts/${contentId}`);
}

// 保存草稿到后端，并更新草稿列表和编辑器内容（如果是新草稿则创建，否则更新）
export async function autosaveDraft(
  contentId: string,
  body: { title?: string; body?: string; payload?: Record<string, unknown>; clientHash?: string }
) {
  return apiRequest<Record<string, unknown>>(`/drafts/${contentId}/autosave`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

export async function generateDraft(body: AiGenerateRequest & { audience?: string }) {
  return apiRequest<AiGenerateResult>("/ai/generate", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function auditText(body: { title: string; body: string }) {
  return apiRequest<AuditResult>("/ai/audit", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function scoreText(body: { title: string; body: string }) {
  return apiRequest<QualityScoreResult>("/ai/score", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function rewriteText(body: { title: string; body: string; reasons?: string[] }) {
  return apiRequest<{ title: string; body: string; reasons: string[] }>("/ai/rewrite", {
    method: "POST",
    body: JSON.stringify(body)
  });
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
  }>("/analytics/events", {
    method: "POST",
    body: JSON.stringify(body)
  });
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
  }>(`/analytics/contents/${contentId}`);
}

export async function login(body: { account: string; password: string }) {
  return apiRequest<{
    accessToken: string;
    tokenType: string;
    expiresIn: number;
    user: Record<string, unknown>;
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function register(body: { account: string; password: string; nickname?: string }) {
  return apiRequest<{
    user: Record<string, unknown>;
    message: string;
  }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function me() {
  return apiRequest<Record<string, unknown>>("/auth/me", {}, true);
}

export async function logout() {
  return apiRequest<{ ok: boolean }>("/auth/logout", { method: "POST" }, true);
}

export function storeAccessToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAccessToken() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

export { API_BASE_URL };
