import { z, type ZodType } from "zod";
import {
  ModelClientService,
  type ModelApiStyle,
  type ModelCacheStrategy,
  type ModelMessage,
  type ModelTelemetryContext,
  type ModelThinkingMode,
} from "./model-client.service";
import { AppError } from "../../common/app-error";

export async function completeStructured<T extends ZodType>(options: {
  modelClient: ModelClientService; name: string; schema: T; messages: ModelMessage[];
  model?: string; temperature?: number; thinking?: ModelThinkingMode; timeoutMs?: number; signal?: AbortSignal; repairAttempts?: number;
  telemetry?: ModelTelemetryContext;
  apiStyle?: ModelApiStyle; cacheStrategy?: ModelCacheStrategy; store?: boolean; maxOutputTokens?: number;
}): Promise<z.output<T>> {
  const jsonSchema = z.toJSONSchema(options.schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const originalMessages = [...options.messages];
  let currentMessages = originalMessages;
  let lastIssues = "invalid JSON";
  const configured = options.repairAttempts ?? Number.parseInt(process.env.STRUCTURED_OUTPUT_REPAIR_ATTEMPTS ?? "1", 10);
  const maxRepairs = Number.isFinite(configured) ? Math.min(2, Math.max(0, configured)) : 1;

  for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
    // 调用模型生成输出
    const completion = await options.modelClient.completeWithMetadata({
      messages: currentMessages, model: options.model, temperature: options.temperature,
      thinking: options.thinking, timeoutMs: options.timeoutMs, signal: options.signal,
      responseFormat: { type: "json_schema", name: options.name, strict: true, schema: jsonSchema },
      telemetry: { scene: options.name, ...options.telemetry },
      apiStyle: options.apiStyle,
      cacheStrategy: options.cacheStrategy,
      store: options.store,
      maxOutputTokens: options.maxOutputTokens,
    });
    const content = completion.text;

    let candidate: unknown;
    try { candidate = JSON.parse(content); } catch { candidate = undefined; }
    const validated = options.schema.safeParse(candidate);
    if (validated.success) {
      await options.modelClient.attachStructuredResult(completion.callLogId, validated.data, { success: true });
      return validated.data;
    }

    lastIssues = validated.error.issues.slice(0, 12)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
    await options.modelClient.attachStructuredResult(
      completion.callLogId,
      { rawText: content, validationIssues: lastIssues },
      { success: false, errorMessage: `structured output validation failed: ${lastIssues}` }
    );

    if (attempt >= maxRepairs) break;
    currentMessages = [...originalMessages, { role: "assistant", content }, {
      role: "user",
      content: `上一个输出未通过 JSON Schema 验证。只修复结构和字段一致性，不改变原语义。\n验证问题：${lastIssues}\n只返回符合既定 JSON Schema 的 JSON 对象。`,
    }];
  }
  throw new AppError({
    code: "UPSTREAM_INVALID_RESPONSE",
    message: `${options.name} structured output validation failed: ${lastIssues}`,
    statusCode: 502,
    retryable: process.env.AI_RETRY_INVALID_RESPONSE === "true",
    details: { agent: options.name, validationIssues: lastIssues },
  });
}
