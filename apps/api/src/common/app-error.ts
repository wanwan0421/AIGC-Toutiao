import { HttpException, HttpStatus } from "@nestjs/common";

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
  if (error instanceof HttpException) {
    const statusCode = error.getStatus();
    const response = error.getResponse();
    const record = response && typeof response === "object" ? response as Record<string, unknown> : {};
    const rawMessage = record.message ?? error.message;
    const message = Array.isArray(rawMessage) ? rawMessage.map(String).join("; ") : String(rawMessage);
    return new AppError({
      code: typeof record.code === "string" ? record.code : httpErrorCode(statusCode),
      message,
      statusCode,
      retryable: statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504,
      details: record.details && typeof record.details === "object"
        ? record.details as Record<string, unknown>
        : undefined,
      cause: error,
    });
  }
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

function httpErrorCode(status: number) {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 422) return "VALIDATION_FAILED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502) return "UPSTREAM_INVALID_RESPONSE";
  if (status === 503) return "SERVICE_UNAVAILABLE";
  if (status === 504) return "UPSTREAM_TIMEOUT";
  return `HTTP_${status}`;
}

export function combineAbortSignals(signals: Array<AbortSignal | undefined>) {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (!active.length) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}
