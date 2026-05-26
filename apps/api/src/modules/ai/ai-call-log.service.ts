import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class AiCallLogService {
  constructor(private readonly prisma: PrismaService) {}

  log(data: {
    scene: string;
    model?: string | null;
    inputSummary?: string;
    output?: unknown;
    latencyMs?: number;
    success: boolean;
    errorMessage?: string;
  }) {
    return this.prisma.aiCallLog.create({
      data: {
        scene: data.scene,
        model: data.model,
        inputSummary: data.inputSummary,
        output: data.output as Prisma.InputJsonValue | undefined,
        latencyMs: data.latencyMs,
        success: data.success,
        errorMessage: data.errorMessage,
      },
    });
  }
}
