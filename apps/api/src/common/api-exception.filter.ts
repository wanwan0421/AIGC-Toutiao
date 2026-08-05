import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiErrorResponse } from "@aicp/shared";
import { randomUUID } from "node:crypto";
import { AppError } from "./app-error";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = String(response.getHeader("X-Request-ID") ?? request.headers["x-request-id"] ?? randomUUID());
    const mapped = this.mapException(exception);
    const payload: ApiErrorResponse = {
      statusCode: mapped.statusCode,
      code: mapped.code,
      message: mapped.message,
      retryable: mapped.retryable,
      requestId,
      ...(mapped.retryAfterMs !== undefined ? { retryAfterMs: mapped.retryAfterMs } : {}),
      ...(mapped.details ? { details: mapped.details } : {}),
    };

    if (mapped.statusCode >= 500) {
      this.logger.error(`${request.method} ${request.originalUrl} failed [${requestId}]: ${mapped.code}`, exception instanceof Error ? exception.stack : undefined);
    }
    response.status(mapped.statusCode).json(payload);
  }

  private mapException(exception: unknown) {
    if (exception instanceof AppError) return exception;
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      const record = typeof response === "object" && response ? (response as Record<string, unknown>) : {};
      const rawMessage = record.message ?? exception.message;
      const message = statusCode >= 500
        ? "服务暂时不可用，请稍后重试"
        : Array.isArray(rawMessage) ? rawMessage.map(String).join("; ") : String(rawMessage);
      return new AppError({
        statusCode,
        code: this.httpCode(statusCode),
        message,
        retryable: statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504,
        details: statusCode < 500 && record.details && typeof record.details === "object"
          ? record.details as Record<string, unknown>
          : undefined,
      });
    }
    return new AppError({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      retryable: false,
      cause: exception,
    });
  }

  private httpCode(status: number) {
    if (status === 400) return "BAD_REQUEST";
    if (status === 401) return "AUTH_REQUIRED";
    if (status === 403) return "FORBIDDEN";
    if (status === 404) return "NOT_FOUND";
    if (status === 409) return "CONFLICT";
    if (status === 422) return "VALIDATION_FAILED";
    if (status === 429) return "RATE_LIMITED";
    if (status === 503) return "SERVICE_UNAVAILABLE";
    return `HTTP_${status}`;
  }
}
