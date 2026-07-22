export const AI_JOB_NAME = "execute-ai-job";
export const AI_JOB_MAINTENANCE_NAME = "maintain-ai-jobs";

export function aiJobConfig() {
  return {
    queueName: process.env.AI_JOB_QUEUE_NAME ?? "ai-jobs",
    workerConcurrency: positiveInt(process.env.AI_JOB_WORKER_CONCURRENCY, 2),
    attempts: positiveInt(process.env.AI_JOB_ATTEMPTS, 3),
    backoffMs: positiveInt(process.env.AI_JOB_BACKOFF_MS, 2_000),
    outboxPollMs: positiveInt(process.env.AI_JOB_OUTBOX_POLL_MS, 2_000),
    cancelPollMs: positiveInt(process.env.AI_JOB_CANCEL_POLL_MS, 1_000),
    commitTtlDays: positiveInt(process.env.AI_JOB_COMMIT_TTL_DAYS, 7),
    eventRetentionDays: positiveInt(process.env.AI_JOB_EVENT_RETENTION_DAYS, 30),
    cleanupBatchSize: positiveInt(process.env.AI_JOB_EVENT_CLEANUP_BATCH_SIZE, 1_000),
    cleanupMaxRows: positiveInt(process.env.AI_JOB_EVENT_CLEANUP_MAX_ROWS, 100_000),
  };
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
