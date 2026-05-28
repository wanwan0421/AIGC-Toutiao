import { Injectable, Logger } from "@nestjs/common";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

@Injectable()
export class ModelClientService {
  private readonly logger = new Logger(ModelClientService.name);
  private readonly apiKey = process.env.ARK_API_KEY;
  private readonly apiBaseUrl = process.env.ARK_API_URL ?? process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3";
  private readonly apiUrl = this.resolveApiUrl(this.apiBaseUrl);
  private readonly defaultModel = process.env.ARK_MODEL_ID ?? process.env.ARK_MODEL;

  hasRemoteProvider() {
    return Boolean(this.apiKey && this.defaultModel);
  }

  modelName(model?: string) {
    return model ?? this.defaultModel;
  }

  async complete(options: {
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
  }) {
    this.assertConfigured(options.model);

    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(this.buildRequestBody(options, false)),
      });

      if (!response.ok) {
        throw new Error(`Ark request failed: ${response.status}`);
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const text = this.extractText(payload);
      if (!text) {
        throw new Error("Ark response did not contain text output");
      }
      return text;
    } catch (error) {
      this.logger.error(`Ark completion failed: ${(error as Error).message}`);
      throw error;
    }
  }

  async *stream(options: {
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
  }) {
    this.assertConfigured(options.model);

    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(this.buildRequestBody(options, true)),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Ark stream failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";

      while (true) {
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
            // Ignore malformed provider stream fragments.
          }
        }
      }
    } catch (error) {
      this.logger.error(`Ark stream failed: ${(error as Error).message}`);
      throw error;
    }
  }

  private assertConfigured(model?: string) {
    if (!this.apiKey) {
      throw new Error("ARK_API_KEY is required for AI calls");
    }
    if (!this.modelName(model)) {
      throw new Error("ARK_MODEL_ID or ARK_MODEL is required for AI calls");
    }
  }

  private resolveApiUrl(rawUrl: string) {
    const normalized = rawUrl.replace(/\/$/, "");
    if (/\/(chat\/completions|responses)$/i.test(normalized)) {
      return normalized;
    }

    return `${normalized}/responses`;
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

    if (/\/chat\/completions$/i.test(this.apiUrl)) {
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
