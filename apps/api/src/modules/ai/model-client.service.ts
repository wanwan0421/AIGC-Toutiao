import { Injectable, Logger } from "@nestjs/common";
import { AppError, combineAbortSignals, throwIfAborted } from "../../common/app-error";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

@Injectable()
export class ModelClientService {
  private readonly logger = new Logger(ModelClientService.name);
  private readonly apiKey = process.env.ARK_API_KEY;
  private readonly apiUrl = (process.env.ARK_API_URL ?? process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3/chat/completions").replace(/\/$/, "");
  private readonly defaultModel = process.env.ARK_MODEL_ID ?? process.env.ARK_MODEL;

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

  async complete(options: {
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }) {
    this.assertConfigured(options.model);

    try {
      const response = await this.fetchWithTimeout(
        this.apiUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(this.buildRequestBody(options, false)),
        },
        options.timeoutMs,
        options.signal
      );

      if (!response.ok) {
        throw await this.upstreamHttpError(response, "Ark request failed", this.modelName(options.model));
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const text = this.extractText(payload);
      if (!text) {
        throw new AppError({ code: "UPSTREAM_INVALID_RESPONSE", message: "Ark response did not contain text output", statusCode: 502, retryable: true });
      }
      return text;
    } catch (error) {
      if (error instanceof AppError && error.code === "JOB_CANCELLED") {
        this.logger.debug(`Ark completion cancelled: ${error.message}`);
      } else {
        this.logger.error(`Ark completion failed: ${(error as Error).message}`);
      }
      throw error;
    }
  }

  async describeImage(imageBuffer: Buffer, mimeType: string, prompt: string = "请用简洁中文描述这张图片的内容，不要超过150字"): Promise<string> {
    if (!this.hasRemoteProvider()) {
      this.logger.warn("Model provider not configured, skip image description");
      return "";
    }

    const base64 = imageBuffer.toString("base64");
    const dataUri = `data:${mimeType};base64,${base64}`;

    try {
      const response = await this.fetchWithTimeout(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(this.buildImageDescriptionRequestBody(dataUri, prompt)),
      });

      if (!response.ok) {
        this.logger.warn(`Describe image request failed: ${response.status}`);
        return "";
      }

      const result = await response.json() as Record<string, unknown>;
      const description = this.extractText(result);
      this.logger.debug(`Image description generated: ${description.slice(0, 80)}`);
      return description;
    } catch (error) {
      this.logger.warn(`Describe image skipped: ${(error as Error).message}`);
      return "";
    }
  }

  async *stream(options: {
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }) {
    this.assertConfigured(options.model);

    try {
      const response = await this.fetchWithTimeout(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(this.buildRequestBody(options, true)),
      }, options.timeoutMs, options.signal);
      if (!response.ok) {
        throw await this.upstreamHttpError(response, "Ark stream failed", this.modelName(options.model));
      }
      if (!response.body) {
        throw new AppError({ code: "UPSTREAM_INVALID_RESPONSE", message: "Ark stream failed: empty response body", statusCode: 502, retryable: true });
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";

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
          if (data === "[DONE]") return;
          try {
            const payload = JSON.parse(data) as Record<string, unknown>;
            const delta = this.extractDelta(payload, eventType);
            if (delta) yield delta;
          } catch {
          }
        }
      }
    } catch (error) {
      if (error instanceof AppError && error.code === "JOB_CANCELLED") {
        this.logger.debug(`Ark stream cancelled: ${error.message}`);
      } else {
        this.logger.error(`Ark stream failed: ${(error as Error).message}`);
      }
      throw error;
    }
  }

  private assertConfigured(model?: string) {
    if (!this.apiKey) {
      throw new Error("ARK_API_KEY is required for AI calls");
    }
    const modelName = this.modelName(model);
    if (!modelName) {
      throw new Error("ARK_MODEL_ID or ARK_MODEL is required for AI calls");
    }
    if (this.isPlaceholderModel(modelName)) {
      throw new Error(`Invalid Ark model configuration: ${modelName}`);
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

  private async formatArkError(response: Response, prefix = "Ark request failed", model = this.modelName()) {
    const body = await response.text().catch(() => "");
    const detail = body.trim().replace(/\s+/g, " ").slice(0, 500);
    const suffix = [
      `status=${response.status}`,
      model ? `model=${model}` : "",
      `url=${this.apiUrl}`,
      detail ? `body=${detail}` : "",
    ].filter(Boolean);
    return `${prefix}: ${suffix.join("; ")}`;
  }

  private async upstreamHttpError(response: Response, prefix: string, model?: string) {
    const message = await this.formatArkError(response, prefix, model);
    const retryAfterMs = this.retryAfterMs(response.headers.get("retry-after"));
    if (response.status === 429) {
      return new AppError({ code: "UPSTREAM_RATE_LIMITED", message, statusCode: 503, retryable: true, retryAfterMs });
    }
    if (response.status === 401 || response.status === 403) {
      return new AppError({ code: "UPSTREAM_AUTH_FAILED", message, statusCode: 502, retryable: false });
    }
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      return new AppError({ code: "UPSTREAM_BAD_REQUEST", message, statusCode: 502, retryable: false });
    }
    return new AppError({
      code: response.status >= 500 ? "UPSTREAM_UNAVAILABLE" : "UPSTREAM_INVALID_RESPONSE",
      message,
      statusCode: 502,
      retryable: response.status >= 500 || process.env.AI_RETRY_INVALID_RESPONSE === "true",
      retryAfterMs,
    });
  }

  private retryAfterMs(value: string | null) {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
  }

  private buildRequestBody(
    options: {
      messages: ChatMessage[];
      model?: string;
      temperature?: number;
    },
    stream: boolean
  ) {
    const base = {
      model: this.modelName(options.model),
      temperature: options.temperature ?? 0.7,
      ...(stream ? { stream: true } : {}),
    };

    if (this.usesChatCompletions()) {
      return {
        ...base,
        messages: options.messages,
      };
    }

    return {
      ...base,
      input: this.buildInput(options.messages),
    };
  }

  private buildInput(messages: ChatMessage[]) {
    return messages
      .map((message) => {
        const roleLabel = message.role === "system" ? "系统" : message.role === "assistant" ? "助手" : "用户";
        return `${roleLabel}：${message.content}`;
      })
      .join("\n\n");
  }

  private buildImageDescriptionRequestBody(dataUri: string, prompt: string) {
    const base = {
      model: this.modelName(),
      temperature: 0.1,
    };

    if (this.usesChatCompletions()) {
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

  private usesChatCompletions() {
    return /\/chat\/completions$/i.test(this.apiUrl);
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
