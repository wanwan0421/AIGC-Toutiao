import { Injectable } from "@nestjs/common";
import type { AiGenerateRequest } from "@aicp/shared";
import { Prisma } from "@prisma/client";
import { buildAuditResult, buildQualityScore, makeGeneratedDraft } from "../../common/business-rules";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(request: AiGenerateRequest & { audience?: string }) {
    const startedAt = Date.now();
    const prompt = request.promptTemplateId
      ? await this.prisma.promptTemplate.findUnique({ where: { id: request.promptTemplateId } })
      : null;

    if (prompt) {
      await this.prisma.promptTemplate.update({
        where: { id: prompt.id },
        data: { usageCount: { increment: 1 } }
      });
    }

    const result = makeGeneratedDraft(request.topic, request.style, request.materialNotes);
    await this.log({
      scene: "generate",
      model: prompt?.model ?? "mock-doubao-seed",
      inputSummary: JSON.stringify({
        topic: request.topic,
        style: request.style,
        platform: request.platform,
        promptTemplateId: request.promptTemplateId
      }),
      output: result,
      latencyMs: Date.now() - startedAt,
      success: true
    });

    return {
      ...result,
      promptTemplateId: prompt?.id,
      provider: "volcengine-ark-mock"
    };
  }

  async audit(body: { title: string; body: string }) {
    const startedAt = Date.now();
    const result = buildAuditResult(body.title, body.body);
    await this.log({
      scene: "audit",
      model: "mock-doubao-seed",
      inputSummary: `${body.title} / ${body.body.slice(0, 80)}`,
      output: result,
      latencyMs: Date.now() - startedAt,
      success: true
    });

    return {
      ...result,
      inputLength: body.title.length + body.body.length
    };
  }

  async score(body: { title: string; body: string }) {
    const startedAt = Date.now();
    const result = buildQualityScore(body.title, body.body);
    await this.log({
      scene: "score",
      model: "mock-doubao-seed",
      inputSummary: `${body.title} / ${body.body.slice(0, 80)}`,
      output: result,
      latencyMs: Date.now() - startedAt,
      success: true
    });

    return {
      ...result,
      inputLength: body.title.length + body.body.length
    };
  }

  async rewrite(body: { title: string; body: string; reasons?: string[] }) {
    const startedAt = Date.now();
    const reasons = body.reasons?.length ? body.reasons : ["优化表达，降低合规风险，增强信息密度。"];
    const result = {
      title: body.title.replace(/绝对|必买|第一/g, "值得参考"),
      body: `${body.body}\n\n合规改写建议：已弱化绝对化表达，补充适用范围，并保留创作者原有观点。\n\n修改原因：${reasons.join("；")}`,
      reasons
    };

    await this.log({
      scene: "rewrite",
      model: "mock-doubao-seed",
      inputSummary: `${body.title} / ${reasons.join(";")}`,
      output: result,
      latencyMs: Date.now() - startedAt,
      success: true
    });

    return result;
  }

  logs() {
    return this.prisma.aiCallLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50
    });
  }

  private log(data: {
    scene: string;
    model: string;
    inputSummary: string;
    output: unknown;
    latencyMs: number;
    success: boolean;
    errorMessage?: string;
  }) {
    return this.prisma.aiCallLog.create({
      data: {
        ...data,
        output: data.output as Prisma.InputJsonValue
      }
    });
  }
}
