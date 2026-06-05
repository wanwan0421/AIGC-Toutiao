import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class AiCallLogService {
  constructor(private readonly prisma: PrismaService) {}

  log(data: {
    scene: string;
    model?: string | null;
    promptKey?: string | null;
    promptVersionId?: string | null;
    promptTemplateId?: string | null;
    inputSummary?: string;
    output?: unknown;
    latencyMs?: number;
    success: boolean;
    errorMessage?: string;
  }) {
    return this.createLog(data);
  }

  private async createLog(data: {
    scene: string;
    model?: string | null;
    promptKey?: string | null;
    promptVersionId?: string | null;
    promptTemplateId?: string | null;
    inputSummary?: string;
    output?: unknown;
    latencyMs?: number;
    success: boolean;
    errorMessage?: string;
  }) {
    const promptContext = data.promptKey ? data : await this.resolvePromptContext(data.scene);
    return this.prisma.aiCallLog.create({
      data: {
        scene: data.scene,
        model: data.model,
        promptKey: data.promptKey ?? promptContext.promptKey,
        promptVersionId: data.promptVersionId ?? promptContext.promptVersionId,
        promptTemplateId: data.promptTemplateId ?? promptContext.promptTemplateId,
        inputSummary: data.inputSummary,
        output: data.output as Prisma.InputJsonValue | undefined,
        latencyMs: data.latencyMs,
        success: data.success,
        errorMessage: data.errorMessage,
      },
    });
  }

  private async resolvePromptContext(scene: string) {
    const definition = await this.prisma.promptDefinition
      .findFirst({
        where: { key: scene },
        select: { key: true, activeVersionId: true },
      })
      .catch(() => null);
    if (definition) {
      return { promptKey: definition.key, promptVersionId: definition.activeVersionId, promptTemplateId: null };
    }

    const legacy = await this.prisma.promptTemplate
      .findFirst({
        where: { name: scene },
        select: { id: true, name: true },
      })
      .catch(() => null);
    return { promptKey: legacy?.name ?? scene, promptVersionId: null, promptTemplateId: legacy?.id ?? null };
  }
}
