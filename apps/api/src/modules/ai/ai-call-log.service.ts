import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { AI_PROMPT_NAMES } from "./prompt-names";

const MATERIAL_SCENES: string[] = [AI_PROMPT_NAMES.directGenerate, AI_PROMPT_NAMES.creativeChat];

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
    success: boolean;
    errorMessage?: string;
  }) {
    const containsPrivateMaterials = MATERIAL_SCENES.includes(data.scene);
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
        inputSummary: containsPrivateMaterials ? undefined : data.inputSummary,
        output: containsPrivateMaterials ? undefined : data.output as Prisma.InputJsonValue | undefined,
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
        success: data.success,
        errorMessage: containsPrivateMaterials && data.errorMessage ? "creative model call failed" : data.errorMessage,
      },
    });
  }

  async attachResult(
    id: string,
    output: unknown,
    validation?: { success: boolean; errorMessage?: string }
  ) {
    if (validation) {
      await this.prisma.aiCallLog.updateMany({
        where: { id },
        data: { success: validation.success, errorMessage: validation.errorMessage ?? null },
      });
    }
    return this.prisma.aiCallLog.updateMany({
      where: { id, scene: { notIn: MATERIAL_SCENES } },
      data: {
        output: output as Prisma.InputJsonValue,
      },
    });
  }
}
