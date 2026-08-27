import { Injectable, Logger, Optional } from "@nestjs/common";
import { AppError, combineAbortSignals, throwIfAborted } from "../../common/app-error";
import { AiCallLogService } from "./ai-call-log.service";

export type ModelToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ModelToolCall[];
};

export type ModelResponseFormat = {
  type: "json_schema";
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type ModelThinkingMode = "enabled" | "disabled";
export type ModelApiStyle = "chat_completions" | "responses";
export type ModelCacheStrategy = "off" | "session" | "prefix";

export type ModelTelemetryContext = {
  scene?: string;
  promptKey?: string;
  promptVersionId?: string;
  inputSummary?: string;
  aiJobId?: string;
  contentId?: string;
  conversationId?: string;
  sessionRebuilt?: boolean;
  rebuildReason?: string;
};

export type ModelResponseMetadata = {
  responseId?: string;
  previousResponseId?: string;
  expireAt?: Date;
  model?: string;
  status?: string;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };
};

export type ModelStreamEvent =
  | { type: "created"; metadata: ModelResponseMetadata }
  | { type: "delta"; text: string }
  | { type: "completed"; metadata: ModelResponseMetadata };

export type CompleteOptions = {
  messages: ModelMessage[];
  model?: string;
  temperature?: number;
  thinking?: ModelThinkingMode;
  timeoutMs?: number;
  signal?: AbortSignal;
  responseFormat?: ModelResponseFormat;
  telemetry?: ModelTelemetryContext;
  apiStyle?: ModelApiStyle;
  cacheStrategy?: ModelCacheStrategy;
  previousResponseId?: string;
  store?: boolean;
  maxOutputTokens?: number;
};

@Injectable()
export class ModelClientService {
  private readonly logger = new Logger(ModelClientService.name);
  private readonly apiKey = process.env.ARK_API_KEY;
  private readonly legacyApiUrl = (process.env.ARK_API_URL ?? process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3/chat/completions").replace(/\/$/, "");
  private readonly chatApiUrl = (process.env.ARK_CHAT_COMPLETIONS_API_URL ?? this.chatUrlFromLegacy()).replace(/\/$/, "");
  private readonly responsesApiUrl = (process.env.ARK_RESPONSES_API_URL ?? this.responsesUrlFromLegacy()).replace(/\/$/, "");
  private readonly defaultModel = process.env.ARK_MODEL_ID ?? process.env.ARK_MODEL;

  constructor(@Optional() private readonly callLogs?: AiCallLogService) {}

  hasRemoteProvider(model?: string) {
    return Boolean(this.apiKey && this.modelName(model));
  }

  modelName(model?: string) {
    const configuredModel = model?.trim();
    if (configuredModel && configuredModel !== "doubao-seed") {
      return configuredModel;
    }
    return this.defaultModel;
  }

  async complete(options: CompleteOptions) {
    return (await this.completeWithMetadata(options)).text;
  }

  // 执行文本补全，返回最终文本结果和模型调用元数据
  async completeWithMetadata(options: CompleteOptions): Promise<{ text: string; callLogId?: string; metadata: ModelResponseMetadata }> {
    this.assertConfigured(options.model);
    const startedAt = Date.now();
    let responsePayload: Record<string, unknown> | undefined;
    const apiStyle = this.resolveApiStyle(options.apiStyle);
    const apiUrl = this.apiUrlFor(apiStyle);

    try {
      const response = await this.fetchWithTimeout(
        apiUrl,
        {
          method: "POST",
          headers: this.requestHeaders(apiStyle),
          body: JSON.stringify(this.buildRequestBody(options, false)),
        },
        options.timeoutMs,
        options.signal
      );

      if (!response.ok) {
        throw await this.upstreamHttpError(response, "Ark request failed", this.modelName(options.model), apiUrl, options.previousResponseId);
      }
      const payload = (await response.json()) as Record<string, unknown>;
      responsePayload = payload;
      const text = this.extractText(payload);
      if (!text) {
        throw new AppError({ code: "UPSTREAM_INVALID_RESPONSE", message: "响应中未包含文本输出", statusCode: 502, retryable: true });
      }
      const callLogId = await this.recordModelCall({
        payload,
        model: options.model,
        telemetry: options.telemetry,
        output: { text },
        latencyMs: Date.now() - startedAt,
        success: true,
        options,
      });
      return { text, callLogId, metadata: this.extractMetadata(payload) };
    } catch (error) {
      await this.recordModelCall({
        payload: responsePayload,
        model: options.model,
        telemetry: options.telemetry,
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: error instanceof Error ? error.message : "Ark completion failed",
        options,
      });
      if (error instanceof AppError && error.code === "JOB_CANCELLED") {
        this.logger.debug(`Ark completion cancelled: ${error.message}`);
      } else {
        this.logger.error(`Ark completion failed: ${(error as Error).message}`);
      }
      throw error;
    }
  }

  async attachStructuredResult(
    callLogId: string | undefined,
    output: unknown,
    validation?: { success: boolean; errorMessage?: string }
  ) {
    if (!callLogId || !this.callLogs) return;
    await this.callLogs.attachResult(callLogId, output, validation).catch((error: unknown) => {
      this.logger.warn(`Failed to attach structured result to Ark usage: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async completeWithTools(options: {
    messages: ModelMessage[];
    tools: Array<Record<string, unknown>>;
    signal?: AbortSignal;
    model?: string;
    thinking?: ModelThinkingMode;
    telemetry?: ModelTelemetryContext;
  }) {
    this.assertConfigured(options.model);
    const startedAt = Date.now();
    let responsePayload: Record<string, unknown> | undefined;
    try {
      const response = await this.fetchWithTimeout(this.chatApiUrl, {
        method: "POST",
        headers: this.requestHeaders("chat_completions"),
        body: JSON.stringify({
          model: this.modelName(options.model),
          messages: options.messages,
          tools: options.tools,
          tool_choice: "auto",
          thinking: { type: options.thinking ?? "enabled" },
        }),
      }, undefined, options.signal);
      if (!response.ok) throw await this.upstreamHttpError(response, "Ark tool call failed", this.modelName(options.model), this.chatApiUrl);
      const payload = await response.json() as Record<string, unknown>;
      responsePayload = payload;
      const result = { text: this.extractText(payload), toolCalls: this.extractToolCalls(payload) };
      await this.recordModelCall({
        payload,
        model: options.model,
        telemetry: options.telemetry,
        output: result,
        latencyMs: Date.now() - startedAt,
        success: true,
        options: { apiStyle: "chat_completions", telemetry: options.telemetry },
      });
      return result;
    } catch (error) {
      await this.recordModelCall({
        payload: responsePayload,
        model: options.model,
        telemetry: options.telemetry,
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: error instanceof Error ? error.message : "Ark tool call failed",
        options: { apiStyle: "chat_completions", telemetry: options.telemetry },
      });
      throw error;
    }
  }

  async describeImage(
    imageBuffer: Buffer,
    mimeType: string,
    prompt: string = "请用简洁中文描述这张图片的内容，不要超过150字",
    signal?: AbortSignal,
    telemetry?: ModelTelemetryContext,
  ): Promise<string> {
    if (!this.hasRemoteProvider()) {
      this.logger.warn("Model provider not configured, skip image description");
      return "";
    }

    const base64 = imageBuffer.toString("base64");
    const dataUri = `data:${mimeType};base64,${base64}`;
    const startedAt = Date.now();
    let responsePayload: Record<string, unknown> | undefined;

    try {
      const response = await this.fetchWithTimeout(this.chatApiUrl, {
        method: "POST",
        headers: this.requestHeaders("chat_completions"),
        body: JSON.stringify(this.buildImageDescriptionRequestBody(dataUri, prompt, "chat_completions")),
      }, undefined, signal);

      if (!response.ok) {
        await this.recordModelCall({
          telemetry: { ...telemetry, scene: "image_description" },
          latencyMs: Date.now() - startedAt,
          success: false,
          errorMessage: `Describe image request failed: ${response.status}`,
          options: { apiStyle: "chat_completions" },
        });
        this.logger.warn(`Describe image request failed: ${response.status}`);
        return "";
      }

      const result = await response.json() as Record<string, unknown>;
      responsePayload = result;
      const description = this.extractText(result);
      await this.recordModelCall({
        payload: result,
        telemetry: { ...telemetry, scene: "image_description" },
        output: description ? { text: description } : undefined,
        latencyMs: Date.now() - startedAt,
        success: Boolean(description),
        errorMessage: description ? undefined : "Ark image description response did not contain text output",
        options: { apiStyle: "chat_completions" },
      });
      this.logger.debug(`Image description generated: ${description.slice(0, 80)}`);
      return description;
    } catch (error) {
      if (!responsePayload) {
        await this.recordModelCall({
          telemetry: { ...telemetry, scene: "image_description" },
          latencyMs: Date.now() - startedAt,
          success: false,
          errorMessage: error instanceof Error ? error.message : "Describe image failed",
          options: { apiStyle: "chat_completions" },
        });
      }
      this.logger.warn(`Describe image skipped: ${(error as Error).message}`);
      return "";
    }
  }

  async *stream(options: CompleteOptions) {
    for await (const event of this.streamWithMetadata(options)) {
      if (event.type === "delta") yield event.text;
    }
  }

  async *streamWithMetadata(options: CompleteOptions): AsyncGenerator<ModelStreamEvent> {
    this.assertConfigured(options.model);
    const startedAt = Date.now();
    let responsePayload: Record<string, unknown> | undefined;
    let succeeded = false;
    let errorMessage: string | undefined;
    let outputText = "";
    let firstTokenLatencyMs: number | undefined;
    let latestMetadata: ModelResponseMetadata = {};
    let createdEmitted = false;
    let completedEmitted = false;
    const apiStyle = this.resolveApiStyle(options.apiStyle);
    const apiUrl = this.apiUrlFor(apiStyle);

    try {
      const response = await this.fetchWithTimeout(apiUrl, {
        method: "POST",
        headers: this.requestHeaders(apiStyle),
        body: JSON.stringify(this.buildRequestBody(options, true)),
      }, options.timeoutMs, options.signal);
      if (!response.ok) {
        throw await this.upstreamHttpError(response, "Ark stream failed", this.modelName(options.model), apiUrl, options.previousResponseId);
      }
      if (!response.body) {
        throw new AppError({ code: "UPSTREAM_INVALID_RESPONSE", message: "Ark stream failed: empty response body", statusCode: 502, retryable: true });
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";
      let streamDone = false;

      while (true) {
        throwIfAborted(options.signal);
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            eventType = "";
            continue;
          }
          if (trimmed.startsWith("event:")) {
            eventType = trimmed.slice(6).trim();
            continue;
          }
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            streamDone = true;
            break;
          }
          try {
            const payload = JSON.parse(data) as Record<string, unknown>;
            const payloadType = eventType || (typeof payload.type === "string" ? payload.type : "");
            const metadata = this.extractMetadata(payload);
            if (metadata.responseId || metadata.status || metadata.usage) {
              latestMetadata = this.mergeMetadata(latestMetadata, metadata);
              responsePayload = payload;
            } else if (this.hasUsage(payload)) {
              responsePayload = payload;
            }
            if (!createdEmitted && latestMetadata.responseId) {
              createdEmitted = true;
              yield { type: "created", metadata: latestMetadata };
            }
            if (/response\.failed|response\.incomplete|error/i.test(payloadType)) {
              throw new AppError({
                code: "UPSTREAM_INVALID_RESPONSE",
                message: this.extractStreamError(payload) || "Ark response stream failed",
                statusCode: 502,
                retryable: true,
                details: { responseId: latestMetadata.responseId, eventType: payloadType },
              });
            }
            const delta = this.extractDelta(payload, eventType);
            if (delta) {
              firstTokenLatencyMs ??= Date.now() - startedAt;
              outputText += delta;
              yield { type: "delta", text: delta };
            }
            if (/response\.completed/i.test(payloadType)) {
              completedEmitted = true;
              succeeded = true;
              yield { type: "completed", metadata: latestMetadata };
            }
          } catch (error) {
            if (error instanceof AppError) throw error;
          }
        }
        if (streamDone) break;
      }
      if (apiStyle === "responses" && !completedEmitted) {
        throw new AppError({
          code: "UPSTREAM_INCOMPLETE_STREAM",
          message: "Ark Responses stream ended before response.completed",
          statusCode: 502,
          retryable: true,
          details: { responseId: latestMetadata.responseId },
        });
      }
      succeeded = true;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Ark stream failed";
      if (error instanceof AppError && error.code === "JOB_CANCELLED") {
        this.logger.debug(`Ark stream cancelled: ${error.message}`);
      } else {
        this.logger.error(`Ark stream failed: ${(error as Error).message}`);
      }
      throw error;
    } finally {
      await this.recordModelCall({
        payload: responsePayload,
        model: options.model,
        telemetry: options.telemetry,
        output: outputText ? { text: outputText } : undefined,
        latencyMs: Date.now() - startedAt,
        success: succeeded,
        errorMessage: succeeded ? undefined : errorMessage ?? "Ark stream interrupted before completion",
        firstTokenLatencyMs,
        options,
      });
    }
  }

  async retrieveResponse(responseId: string, options: Pick<CompleteOptions, "model" | "timeoutMs" | "signal"> = {}) {
    this.assertConfigured(options.model);
    const url = `${this.responsesApiUrl}/${encodeURIComponent(responseId)}`;
    const response = await this.fetchWithTimeout(url, {
      method: "GET",
      headers: this.requestHeaders("responses"),
    }, options.timeoutMs, options.signal);
    if (response.status === 404) return null;
    if (!response.ok) throw await this.upstreamHttpError(response, "Ark response retrieval failed", this.modelName(options.model), url);
    const payload = await response.json() as Record<string, unknown>;
    return {
      text: this.extractText(payload),
      metadata: this.extractMetadata(payload),
      payload,
    };
  }

  private requestHeaders(apiStyle: ModelApiStyle): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      ...(this.fornaxTraceEnabled(apiStyle) ? { "X-Fornax-Trace": "true" } : {}),
    };
  }

  private fornaxTraceEnabled(apiStyle: ModelApiStyle) {
    return apiStyle === "responses" && process.env.ARK_FORNAX_TRACE?.trim().toLowerCase() === "true";
  }

  private hasUsage(payload: Record<string, unknown>) {
    const root = this.responseRoot(payload);
    return Boolean(root.usage && typeof root.usage === "object");
  }

  // 记录模型调用日志，包括输入、输出、耗时、token 使用情况等
  private async recordModelCall(input: {
    payload?: Record<string, unknown>;
    model?: string;
    telemetry?: ModelTelemetryContext;
    output?: unknown;
    latencyMs: number;
    success: boolean;
    errorMessage?: string;
    firstTokenLatencyMs?: number;
    options?: Pick<CompleteOptions, "apiStyle" | "cacheStrategy" | "previousResponseId" | "telemetry">;
  }) {
    if (!this.callLogs) return undefined;
    const root = input.payload ? this.responseRoot(input.payload) : undefined;
    const usage = root?.usage && typeof root.usage === "object" ? root.usage as Record<string, unknown> : undefined;
    const inputDetails = this.asRecord(usage?.input_tokens_details) ?? this.asRecord(usage?.prompt_tokens_details);
    const outputDetails = this.asRecord(usage?.output_tokens_details) ?? this.asRecord(usage?.completion_tokens_details);
    const apiStyle = this.resolveApiStyle(input.options?.apiStyle);
    const metadata = root ? this.extractMetadata(root) : {};
    const telemetry = input.options?.telemetry ?? input.telemetry;

    try {
      const log = await this.callLogs.log({
        scene: telemetry?.scene ?? "model_response",
        model: typeof root?.model === "string" ? root.model : this.modelName(input.model),
        provider: "volcengine_ark",
        apiStyle,
        responseId: typeof root?.id === "string" ? root.id : undefined,
        previousResponseId: metadata.previousResponseId ?? input.options?.previousResponseId,
        responseExpiresAt: metadata.expireAt,
        aiJobId: telemetry?.aiJobId,
        contentId: telemetry?.contentId,
        conversationId: telemetry?.conversationId,
        promptKey: telemetry?.promptKey,
        promptVersionId: telemetry?.promptVersionId,
        inputSummary: telemetry?.inputSummary,
        output: input.output,
        latencyMs: input.latencyMs,
        inputTokens: this.numberValue(usage?.input_tokens ?? usage?.prompt_tokens),
        cachedInputTokens: this.numberValue(inputDetails?.cached_tokens),
        outputTokens: this.numberValue(usage?.output_tokens ?? usage?.completion_tokens),
        reasoningTokens: this.numberValue(outputDetails?.reasoning_tokens),
        totalTokens: this.numberValue(usage?.total_tokens),
        cacheStrategy: input.options?.cacheStrategy ?? "off",
        firstTokenLatencyMs: input.firstTokenLatencyMs,
        sessionRebuilt: telemetry?.sessionRebuilt,
        rebuildReason: telemetry?.rebuildReason,
        traceEnabled: this.fornaxTraceEnabled(apiStyle),
        success: input.success,
        errorMessage: input.errorMessage,
      });
      return log.id;
    } catch (error: unknown) {
      this.logger.warn(`Failed to persist Ark usage: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private responseRoot(payload: Record<string, unknown>) {
    return this.asRecord(payload.response) ?? payload;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  }

  private numberValue(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
  }

  // 检查模型调用是否已配置，包括 API Key 和模型 ID
  private assertConfigured(model?: string) {
    if (!this.apiKey) {
      throw new AppError({
        code: "AI_CONFIGURATION_ERROR",
        message: "ARK_API_KEY是必需的环境变量，用于AI服务调用",
        statusCode: 500,
        retryable: false,
      });
    }
    const modelName = this.modelName(model);
    if (!modelName) {
      throw new AppError({
        code: "AI_CONFIGURATION_ERROR",
        message: "ARK_MODEL_ID or ARK_MODEL是必需的环境变量，用于指定AI模型",
        statusCode: 500,
        retryable: false,
      });
    }
    if (this.isPlaceholderModel(modelName)) {
      throw new AppError({
        code: "AI_CONFIGURATION_ERROR",
        message: `请将环境变量中的模型ID设置为有效的值: ${modelName}`,
        statusCode: 500,
        retryable: false,
      });
    }
  }

  private isPlaceholderModel(model: string) {
    const normalized = model.trim().toLowerCase();
    return (
      normalized === "replace-with-model-id" ||
      normalized === "your-ark-model-id" ||
      normalized === "your-model-id" ||
      normalized === "doubao-seed"
    );
  }

  private async fetchWithTimeout(input: string, init: RequestInit, timeoutMs?: number, externalSignal?: AbortSignal) {
    throwIfAborted(externalSignal);
    const controller = timeoutMs ? new AbortController() : undefined;
    const timeout = timeoutMs
      ? setTimeout(() => controller!.abort(new AppError({
          code: "UPSTREAM_TIMEOUT",
          message: `Ark request timed out after ${timeoutMs}ms`,
          statusCode: 504,
          retryable: true,
        })), timeoutMs)
      : undefined;
    const signal = combineAbortSignals([init.signal ?? undefined, externalSignal, controller?.signal]);
    try {
      return await fetch(input, { ...init, signal });
    } catch (error) {
      if (externalSignal?.aborted) throwIfAborted(externalSignal);
      if (controller?.signal.aborted && controller.signal.reason instanceof AppError) throw controller.signal.reason;
      if (error instanceof AppError) throw error;
      throw new AppError({ code: "UPSTREAM_UNAVAILABLE", message: error instanceof Error ? error.message : "Ark request failed", statusCode: 503, retryable: true, cause: error });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  public resolveTimeoutMs(value: unknown, fallback: number) {
    const configured = Number.parseInt(String(value ?? ""), 10);
    if (Number.isFinite(configured) && configured > 0) {
      return Math.min(Math.max(configured, 1000), 300000);
    }
    return fallback;
  }

  private async upstreamHttpError(
    response: Response,
    prefix = "Ark request failed",
    model = this.modelName(),
    apiUrl = this.chatApiUrl,
    previousResponseId?: string
  ) {
    const body = await response.text().catch(() => "");
    const detail = body.trim().replace(/\s+/g, " ").slice(0, 500);
    const suffix = [
      `status=${response.status}`,
      model ? `model=${model}` : "",
      `url=${apiUrl}`,
      detail ? `body=${detail}` : "",
    ].filter(Boolean);
    const diagnostic = `${prefix}: ${suffix.join("; ")}`;
    this.logger.error(diagnostic);
    const message = response.status === 429 ? "AI 服务请求过于频繁" : "AI 服务暂时不可用";
    const retryAfterMs = this.retryAfterMs(response.headers.get("retry-after"));
    const details = { upstreamStatus: response.status, upstreamBody: detail, previousResponseId };
    if (response.status === 429) {
      return new AppError({ code: "UPSTREAM_RATE_LIMITED", message, statusCode: 503, retryable: true, retryAfterMs, details });
    }
    if (response.status === 401 || response.status === 403) {
      return new AppError({ code: "UPSTREAM_AUTH_FAILED", message, statusCode: 502, retryable: false, details });
    }
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      const previousInvalid = Boolean(previousResponseId) && (response.status === 404 || /previous[_ ]?response|expired|not found|不存在|过期/i.test(detail));
      return new AppError({
        code: previousInvalid ? "UPSTREAM_PREVIOUS_RESPONSE_INVALID" : "UPSTREAM_BAD_REQUEST",
        message,
        statusCode: 502,
        retryable: false,
        details,
      });
    }
    return new AppError({
      code: response.status >= 500 ? "UPSTREAM_UNAVAILABLE" : "UPSTREAM_INVALID_RESPONSE",
      message,
      statusCode: 502,
      retryable: response.status >= 500 || process.env.AI_RETRY_INVALID_RESPONSE === "true",
      retryAfterMs,
      details,
    });
  }

  private retryAfterMs(value: string | null) {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
  }

  // 构建请求体，根据是否使用聊天补全接口，生成不同的请求格式
  private buildRequestBody(
    options: {
      messages: ModelMessage[];
      model?: string;
      temperature?: number;
      thinking?: ModelThinkingMode;
      responseFormat?: ModelResponseFormat;
      apiStyle?: ModelApiStyle;
      cacheStrategy?: ModelCacheStrategy;
      previousResponseId?: string;
      store?: boolean;
      maxOutputTokens?: number;
    },
    stream: boolean
  ) {
    const base = {
      model: this.modelName(options.model),
      temperature: options.temperature ?? 0.7,
      thinking: { type: options.thinking ?? "enabled" },
      ...(stream ? { stream: true } : {}),
    };

    const apiStyle = this.resolveApiStyle(options.apiStyle);
    if (apiStyle === "chat_completions") {
      return {
        ...base,
        messages: options.messages,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
        ...(options.responseFormat
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: options.responseFormat.name,
                  strict: options.responseFormat.strict ?? true,
                  schema: options.responseFormat.schema,
                },
              },
            }
          : {}),
      };
    }

    return {
      ...base,
      input: this.buildResponsesInput(options.messages),
      ...(options.previousResponseId ? { previous_response_id: options.previousResponseId } : {}),
      ...(options.store !== undefined ? { store: options.store } : {}),
      ...(options.cacheStrategy && options.cacheStrategy !== "off" ? { caching: { type: "enabled" } } : {}),
      ...(options.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
      ...(options.responseFormat
        ? {
            text: {
              format: {
                type: "json_schema",
                name: options.responseFormat.name,
                strict: options.responseFormat.strict ?? true,
                schema: options.responseFormat.schema,
              },
            },
          }
        : {}),
    };
  }

  private buildResponsesInput(messages: ModelMessage[]) {
    return messages.map((message) => ({
      type: "message",
      role: message.role,
      content: message.content,
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    }));
  }

  private extractToolCalls(payload: Record<string, unknown>): ModelToolCall[] {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const message = (choices[0] as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined;
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    return calls.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const record = value as Record<string, unknown>;
      const fn = record.function as Record<string, unknown> | undefined;
      if (typeof record.id !== "string" || typeof fn?.name !== "string" || typeof fn.arguments !== "string") return [];
      return [{ id: record.id, type: "function" as const, function: { name: fn.name, arguments: fn.arguments } }];
    });
  }

  private buildImageDescriptionRequestBody(dataUri: string, prompt: string, apiStyle: ModelApiStyle) {
    const base = {
      model: this.modelName(),
      temperature: 0.1,
    };

    if (apiStyle === "chat_completions") {
      return {
        ...base,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUri } },
              { type: "text", text: prompt },
            ],
          },
        ],
      };
    }

    return {
      ...base,
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: dataUri },
            { type: "input_text", text: prompt },
          ],
        },
      ],
    };
  }

  private resolveApiStyle(value?: ModelApiStyle): ModelApiStyle {
    if (value) return value;
    return /\/responses$/i.test(this.legacyApiUrl) ? "responses" : "chat_completions";
  }

  private apiUrlFor(apiStyle: ModelApiStyle) {
    return apiStyle === "responses" ? this.responsesApiUrl : this.chatApiUrl;
  }

  private chatUrlFromLegacy() {
    if (/\/chat\/completions$/i.test(this.legacyApiUrl)) return this.legacyApiUrl;
    const base = this.legacyApiUrl.replace(/\/responses$/i, "");
    return `${base}/chat/completions`;
  }

  private responsesUrlFromLegacy() {
    if (/\/responses$/i.test(this.legacyApiUrl)) return this.legacyApiUrl;
    if (/\/chat\/completions$/i.test(this.legacyApiUrl)) {
      return this.legacyApiUrl.replace(/\/chat\/completions$/i, "/responses");
    }
    return `${this.legacyApiUrl}/responses`;
  }

  private extractMetadata(payload: Record<string, unknown>): ModelResponseMetadata {
    const root = this.responseRoot(payload);
    const usage = this.asRecord(root.usage);
    const inputDetails = this.asRecord(usage?.input_tokens_details) ?? this.asRecord(usage?.prompt_tokens_details);
    const outputDetails = this.asRecord(usage?.output_tokens_details) ?? this.asRecord(usage?.completion_tokens_details);
    const expireAtValue = root.expire_at;
    const expireAt = typeof expireAtValue === "number"
      ? new Date(expireAtValue * 1_000)
      : typeof expireAtValue === "string" && !Number.isNaN(Date.parse(expireAtValue))
        ? new Date(expireAtValue)
        : undefined;
    return {
      responseId: typeof root.id === "string" ? root.id : undefined,
      previousResponseId: typeof root.previous_response_id === "string" ? root.previous_response_id : undefined,
      expireAt,
      model: typeof root.model === "string" ? root.model : undefined,
      status: typeof root.status === "string" ? root.status : undefined,
      usage: usage
        ? {
            inputTokens: this.numberValue(usage.input_tokens ?? usage.prompt_tokens),
            cachedInputTokens: this.numberValue(inputDetails?.cached_tokens),
            outputTokens: this.numberValue(usage.output_tokens ?? usage.completion_tokens),
            reasoningTokens: this.numberValue(outputDetails?.reasoning_tokens),
            totalTokens: this.numberValue(usage.total_tokens),
          }
        : undefined,
    };
  }

  private extractStreamError(payload: Record<string, unknown>) {
    const root = this.responseRoot(payload);
    const error = this.asRecord(root.error) ?? this.asRecord(payload.error);
    return typeof error?.message === "string" ? error.message : "";
  }

  private mergeMetadata(current: ModelResponseMetadata, next: ModelResponseMetadata): ModelResponseMetadata {
    return {
      responseId: next.responseId ?? current.responseId,
      previousResponseId: next.previousResponseId ?? current.previousResponseId,
      expireAt: next.expireAt ?? current.expireAt,
      model: next.model ?? current.model,
      status: next.status ?? current.status,
      usage: next.usage ?? current.usage,
    };
  }

  private extractText(payload: Record<string, unknown>) {
    const outputText = payload.output_text;
    if (typeof outputText === "string") return outputText;

    const text = payload.text;
    if (typeof text === "string") return text;

    const content = payload.content;
    if (typeof content === "string") return content;

    const choices = payload.choices;
    if (Array.isArray(choices)) {
      const firstChoice = choices[0] as Record<string, unknown> | undefined;
      const message = firstChoice?.message as Record<string, unknown> | undefined;
      const messageContent = message?.content;
      if (typeof messageContent === "string") return messageContent;

      const contentParts = messageContent as unknown;
      if (Array.isArray(contentParts)) {
        const textItems = contentParts.filter(
          (item: unknown) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text"
        ) as Array<{ type: string; text: string }>;
        if (textItems.length) {
          return textItems.map((t) => t.text).join("\n");
        }
      }
    }

    const output = payload.output;
    if (Array.isArray(output)) {
      const collected = output
        .map((item) => this.extractTextFromAny(item))
        .filter((item): item is string => Boolean(item));
      if (collected.length) return collected.join("");
    }

    return "";
  }

  private extractDelta(payload: Record<string, unknown>, eventType?: string) {
    const payloadType = typeof payload.type === "string" ? payload.type : "";
    const streamType = eventType || payloadType;

    if (/reasoning/i.test(streamType)) {
      return "";
    }

    if (streamType && !/delta|content|output_text/i.test(streamType)) {
      return "";
    }

    const delta = payload.delta;
    if (typeof delta === "string") return delta;
    const deltaText = this.extractTextFromAny(delta);
    if (deltaText) return deltaText;

    const choices = payload.choices;
    if (Array.isArray(choices)) {
      const firstChoice = choices[0] as Record<string, unknown> | undefined;
      const choiceDelta = firstChoice?.delta as Record<string, unknown> | undefined;
      const choiceDeltaText = this.extractTextFromAny(choiceDelta);
      if (choiceDeltaText) return choiceDeltaText;
    }

    if (streamType && /delta/i.test(streamType)) {
      return this.extractTextFromAny(payload);
    }

    return "";
  }

  private extractTextFromAny(value: unknown): string {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";

    const record = value as Record<string, unknown>;
    for (const key of ["output_text", "text", "content", "delta"]) {
      const candidate = record[key];
      if (typeof candidate === "string") return candidate;
      if (candidate && typeof candidate === "object") {
        const nested = this.extractTextFromAny(candidate);
        if (nested) return nested;
      }
    }

    const content = record.content;
    if (Array.isArray(content)) {
      const collected = content
        .map((item) => this.extractTextFromAny(item))
        .filter((item): item is string => Boolean(item));
      if (collected.length) return collected.join("");
    }

    return "";
  }
}
