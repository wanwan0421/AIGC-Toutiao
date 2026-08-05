import { AiJobStatus, AiJobType, type AiJobSnapshot } from "@aicp/shared";

export type AiJobRecord = {
  id: string;
  userId: string;
  contentId: string | null;
  conversationId: string | null;
  assistantMessageId: string | null;
  type: string;
  status: string;
  progress: number;
  currentStep: string | null;
  input: unknown;
  result: unknown;
  errorMessage: string | null;
  errorCode: string | null;
  errorRetryable: boolean;
  warnings: string[];
  attempts: number;
  startedAt: Date | null;
  resultReadyAt: Date | null;
  appliedAt: Date | null;
  appliedEventId: bigint | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function toAiJobSnapshot(job: AiJobRecord): AiJobSnapshot {
  return {
    id: job.id,
    type: job.type as AiJobType,
    status: job.status as AiJobStatus,
    contentId: job.contentId,
    conversationId: job.conversationId,
    assistantMessageId: job.assistantMessageId,
    progress: job.progress,
    currentStep: job.currentStep,
    input: toRecord(job.input),
    result: job.result,
    errorMessage: job.errorMessage,
    errorCode: job.errorCode,
    errorRetryable: job.errorRetryable,
    warnings: job.warnings,
    attempts: job.attempts,
    startedAt: job.startedAt?.toISOString() ?? null,
    resultReadyAt: job.resultReadyAt?.toISOString() ?? null,
    appliedAt: job.appliedAt?.toISOString() ?? null,
    appliedEventId: job.appliedEventId?.toString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export function isTerminalJobStatus(status: string) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
