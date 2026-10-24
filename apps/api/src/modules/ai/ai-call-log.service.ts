import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { AI_PROMPT_NAMES } from "./prompt-names";

const PRIVATE_CREATIVE_SCENES = new Set<string>([AI_PROMPT_NAMES.directGenerate, AI_PROMPT_NAMES.creativeChat]);

@Injectable()
export class AiCallLogService {
  constructor(private readonly prisma: PrismaService) {}

  log(data: {
    scene: string;
    model?: string | null;
    provider?: string | null;
    apiStyle?: string | null;
    responseId?: string | null;
    previousResponseId?: string | null;
    responseExpiresAt?: Date | null;
    aiJobId?: string | null;
    contentId?: string | null;
    conversationId?: string | null;
    promptKey?: string | null;
    promptVersionId?: string | null;
    stage?: string | null;
    attempt?: number;
    inputSummary?: string;
    output?: unknown;
    latencyMs?: number;
    inputTokens?: number | null;
    cachedInputTokens?: number | null;
    outputTokens?: number | null;
    reasoningTokens?: number | null;
    totalTokens?: number | null;
    cacheStrategy?: string | null;
    firstTokenLatencyMs?: number | null;
    sessionRebuilt?: boolean | null;
    rebuildReason?: string | null;
    traceEnabled?: boolean | null;
    thinkingMode?: string | null;
    billingUnits?: number;
    success: boolean;
    errorMessage?: string;
  }) {
    return this.prisma.aiCallLog.create({
      data: {
        scene: data.scene,
        model: data.model,
        provider: data.provider,
        apiStyle: data.apiStyle,
        responseId: data.responseId,
        previousResponseId: data.previousResponseId,
        responseExpiresAt: data.responseExpiresAt,
        aiJobId: data.aiJobId,
        contentId: data.contentId,
        conversationId: data.conversationId,
        promptKey: data.promptKey,
        promptVersionId: data.promptVersionId,
        stage: data.stage,
        attempt: data.attempt ?? 1,
        inputSummary: this.inputFingerprint(data.inputSummary),
        output: this.outputFingerprint(data.output, data.apiStyle) as Prisma.InputJsonValue | undefined,
        latencyMs: data.latencyMs,
        inputTokens: data.inputTokens,
        cachedInputTokens: data.cachedInputTokens,
        outputTokens: data.outputTokens,
        reasoningTokens: data.reasoningTokens,
        totalTokens: data.totalTokens,
        cacheStrategy: data.cacheStrategy,
        firstTokenLatencyMs: data.firstTokenLatencyMs,
        sessionRebuilt: data.sessionRebuilt,
        rebuildReason: data.rebuildReason,
        traceEnabled: data.traceEnabled,
        thinkingMode: data.thinkingMode,
        pricingSnapshot: this.pricingSnapshot({
          model: data.model,
          apiStyle: data.apiStyle,
          inputTokens: data.inputTokens,
          cachedInputTokens: data.cachedInputTokens,
          outputTokens: data.outputTokens,
          billingUnits: data.billingUnits,
          success: data.success,
        }) as Prisma.InputJsonValue | undefined,
        success: data.success,
        errorMessage: PRIVATE_CREATIVE_SCENES.has(data.scene) && data.errorMessage ? "creative model call failed" : data.errorMessage,
      },
    });
  }

  private pricingSnapshot(input: {
    model?: string | null;
    apiStyle?: string | null;
    inputTokens?: number | null;
    cachedInputTokens?: number | null;
    outputTokens?: number | null;
    billingUnits?: number;
    success: boolean;
  }) {
    const model = input.model?.toLowerCase().replaceAll(".", "-") ?? "";
    const effectiveAt = "2026-10-10";
    const sourceUrl = "https://console.volcengine.com/ark/region:cn-beijing/docs/model-pricing";

    if (input.apiStyle === "images") {
      const pricePerImage = model.includes("seedream-4-5") ? 0.25
        : model.includes("seedream-4-0") ? 0.2
          : model.includes("seedream-5-0-lite") ? 0.22
            : model.includes("seedream-5-0-flash") ? 0.12
              : undefined;
      const units = input.success ? Math.max(0, input.billingUnits ?? 1) : 0;
      return {
        currency: "CNY",
        billingUnit: "image",
        units,
        unitPrice: pricePerImage ?? null,
        cost: pricePerImage === undefined ? null : Number((pricePerImage * units).toFixed(6)),
        priceTier: "online_standard_list_estimate",
        effectiveAt,
        sourceUrl,
      };
    }

    const rates = model.includes("seed-evolving") || model.includes("seed-2-1-pro")
      ? { inputPerMillion: 6, cachedInputPerMillion: 1.2, outputPerMillion: 30 }
      : model.includes("seed-2-1-lite")
        ? { inputPerMillion: 0.8, cachedInputPerMillion: 0.16, outputPerMillion: 2.7 }
        : undefined;
    if (!rates) return undefined;

    const inputTokens = Math.max(0, input.inputTokens ?? 0);
    const cachedInputTokens = Math.min(inputTokens, Math.max(0, input.cachedInputTokens ?? 0));
    const outputTokens = Math.max(0, input.outputTokens ?? 0);
    const uncachedInputTokens = inputTokens - cachedInputTokens;
    const inputCost = uncachedInputTokens * rates.inputPerMillion / 1_000_000;
    const cachedInputCost = cachedInputTokens * rates.cachedInputPerMillion / 1_000_000;
    const outputCost = outputTokens * rates.outputPerMillion / 1_000_000;
    return {
      currency: "CNY",
      billingUnit: "token",
      ...rates,
      inputCost: Number(inputCost.toFixed(9)),
      cachedInputCost: Number(cachedInputCost.toFixed(9)),
      outputCost: Number(outputCost.toFixed(9)),
      cost: Number((inputCost + cachedInputCost + outputCost).toFixed(9)),
      priceTier: "online_standard_list_estimate",
      effectiveAt,
      sourceUrl,
    };
  }

  async attachResult(
    id: string,
    output: unknown,
    validation?: { success: boolean; errorMessage?: string }
  ) {
    return this.prisma.aiCallLog.updateMany({
      where: { id },
      data: {
        output: this.outputFingerprint(output) as Prisma.InputJsonValue | undefined,
        ...(validation ? { success: validation.success, errorMessage: validation.errorMessage ?? null } : {}),
      },
    });
  }

  // Call logs contain stable fingerprints, never the author's source text or generated content.
  private inputFingerprint(input?: string) {
    if (input === undefined) return undefined;
    return `sha256:${createHash("sha256").update(input).digest("hex")};chars:${input.length}`;
  }

  private outputFingerprint(output: unknown, apiStyle?: string | null) {
    if (output === undefined || output === null) return undefined;
    const text = typeof output === "string" ? output : JSON.stringify(output);
    if (text === undefined) return undefined;
    return {
      kind: apiStyle === "images" ? "image" : typeof output === "object" && output !== null && "text" in output ? "text" : "structured",
      sha256: createHash("sha256").update(text).digest("hex"),
      chars: text.length,
    };
  }
}
