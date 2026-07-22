import type { AiJobResultCommitRequest, AiJobSnapshot, AiJobType } from "@aicp/shared";

const AI_JOB_SESSION_KEY = "aicp:active-ai-jobs:v1";

export type StoredAiJobSession = {
  jobId: string;
  type: AiJobType;
  contentId?: string | null;
  lastEventId?: string;
  pendingCommit?: AiJobResultCommitRequest;
  startedAt: number;
  updatedAt: number;
};

function storage() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

export function listStoredAiJobs(): StoredAiJobSession[] {
  const target = storage();
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(AI_JOB_SESSION_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isStoredAiJobSession)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
}

// 持久化 AI 任务会话
export function persistAiJobSession(job: AiJobSnapshot, lastEventId?: string) {
  const now = Date.now();
  const current = listStoredAiJobs();
  const existing = current.find((item) => item.jobId === job.id);
  const next: StoredAiJobSession = {
    jobId: job.id,
    type: job.type,
    contentId: job.contentId,
    lastEventId: lastEventId ?? existing?.lastEventId,
    pendingCommit: existing?.pendingCommit,
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
  };
  writeStoredAiJobs([next, ...current.filter((item) => item.jobId !== job.id)]);
  return next;
}

export function setStoredAiJobPendingCommit(jobId: string, pendingCommit: AiJobResultCommitRequest) {
  const current = listStoredAiJobs();
  const existing = current.find((item) => item.jobId === jobId);
  if (!existing) return;
  writeStoredAiJobs([
    { ...existing, pendingCommit, updatedAt: Date.now() },
    ...current.filter((item) => item.jobId !== jobId),
  ]);
}

export function clearStoredAiJobPendingCommit(jobId: string) {
  const current = listStoredAiJobs();
  const existing = current.find((item) => item.jobId === jobId);
  if (!existing?.pendingCommit) return;
  const { pendingCommit: _pendingCommit, ...next } = existing;
  writeStoredAiJobs([{ ...next, updatedAt: Date.now() }, ...current.filter((item) => item.jobId !== jobId)]);
}

export function updateStoredAiJobEventId(jobId: string, lastEventId: string) {
  if (!/^\d+$/.test(lastEventId)) return;
  const current = listStoredAiJobs();
  const existing = current.find((item) => item.jobId === jobId);
  if (!existing) return;
  writeStoredAiJobs([
    { ...existing, lastEventId, updatedAt: Date.now() },
    ...current.filter((item) => item.jobId !== jobId),
  ]);
}

export function removeStoredAiJob(jobId: string) {
  writeStoredAiJobs(listStoredAiJobs().filter((item) => item.jobId !== jobId));
}

export function clearStoredAiJobs() {
  const target = storage();
  if (!target) return;
  try {
    target.removeItem(AI_JOB_SESSION_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function writeStoredAiJobs(jobs: StoredAiJobSession[]) {
  const target = storage();
  if (!target) return;
  try {
    target.setItem(AI_JOB_SESSION_KEY, JSON.stringify(jobs));
  } catch {
    // A failed sessionStorage write must not stop the AI task itself.
  }
}

function isStoredAiJobSession(value: unknown): value is StoredAiJobSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<StoredAiJobSession>;
  return (
    typeof record.jobId === "string" &&
    typeof record.type === "string" &&
    typeof record.startedAt === "number" &&
    typeof record.updatedAt === "number" &&
    (record.lastEventId === undefined || /^\d+$/.test(record.lastEventId))
  );
}
