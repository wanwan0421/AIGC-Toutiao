import { HttpStatus } from "@nestjs/common";

export type AppErrorOptions = {
  code: string;
  message: string;
  statusCode?: number;
  retryable?: boolean;
  retryAfterMs?: number;
  details?: Record<string, unknown>;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly details?: Record<string, unknown>;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.details = options.details;
  }
}

export function jobCancelledError(reason = "AI task was cancelled") {
  return new AppError({
    code: "JOB_CANCELLED",
    message: reason,
    statusCode: 409,
    retryable: false,
  });
}

export function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof AppError) throw signal.reason;
  throw jobCancelledError(typeof signal.reason === "string" ? signal.reason : undefined);
}

export function asAppError(error: unknown, fallback: Partial<AppErrorOptions> = {}) {
  if (error instanceof AppError) return error;
  if (error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message))) {
    return new AppError({
      code: fallback.code ?? "UPSTREAM_ABORTED",
      message: fallback.message ?? error.message ?? "Upstream request was aborted",
      statusCode: fallback.statusCode ?? 503,
      retryable: fallback.retryable ?? true,
      cause: error,
    });
  }
  return new AppError({
    code: fallback.code ?? "INTERNAL_ERROR",
    message: fallback.message ?? (error instanceof Error ? error.message : "Internal server error"),
    statusCode: fallback.statusCode ?? 500,
    retryable: fallback.retryable ?? false,
    retryAfterMs: fallback.retryAfterMs,
    details: fallback.details,
    cause: error,
  });
}

export function combineAbortSignals(signals: Array<AbortSignal | undefined>) {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (!active.length) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}
