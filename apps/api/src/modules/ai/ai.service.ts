import { Injectable } from "@nestjs/common";
import type {
  AiGenerateRequest,
  CreativeChatRequest,
  DirectGenerateRequest,
  SelectionRewriteRequest,
  TitleGenerateRequest,
} from "@aicp/shared";
import { Prisma } from "@prisma/client";
import { buildAuditResult, buildQualityScore } from "../../common/business-rules";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { ConversationArchiveService } from "./conversation-archive.service";
import { CreativeOrchestratorService } from "./creative-orchestrator.service";
import { ContextBuilderService } from "./context-builder.service";

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creativeOrchestrator: CreativeOrchestratorService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly conversations: ConversationArchiveService
  ) {}

  async generate(request: AiGenerateRequest & { audience?: string; userId?: string }) {
    const startedAt = Date.now();
    const draft = await this.creativeOrchestrator.directGenerate({
      theme: request.topic,
      audience: request.audience,
      style: request.style,
      materialNotes: request.materialNotes,
    });
    const result = {
      title: draft.title,
      body: draft.bodyMarkdown,
      tags: draft.tags,
      coverSuggestion: draft.coverSuggestion,
    };

    await this.log({
      scene: "generate",
      model: "creative-orchestrator",
      inputSummary: JSON.stringify({
        topic: request.topic,
        style: request.style,
        platform: request.platform,
        promptTemplateId: request.promptTemplateId,
      }),
      output: result,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return {
      ...result,
      provider: "volcengine-ark",
    };
  }

  async audit(body: { title: string; body: string }) {
    const startedAt = Date.now();
    const result = buildAuditResult(body.title, body.body);
    await this.log({
      scene: "audit",
      model: "rule-based-audit",
      inputSummary: `${body.title} / ${body.body.slice(0, 80)}`,
      output: result,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return {
      ...result,
      inputLength: body.title.length + body.body.length,
    };
  }

  async score(body: { title: string; body: string }) {
    const startedAt = Date.now();
    const result = buildQualityScore(body.title, body.body);
    await this.log({
      scene: "score",
      model: "rule-based-score",
      inputSummary: `${body.title} / ${body.body.slice(0, 80)}`,
      output: result,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return {
      ...result,
      inputLength: body.title.length + body.body.length,
    };
  }

  async rewrite(body: { title: string; body: string; reasons?: string[] }) {
    const startedAt = Date.now();
    const reasons = body.reasons?.length ? body.reasons : ["优化表达并降低合规风险"];
    const result = {
      title: body.title.replace(/绝对|必买|第一/g, "值得参考"),
      body: `${body.body}\n\n合规改写建议：已弱化绝对化表达，补充适用范围，并保留创作者原有观点。\n\n修改原因：${reasons.join("；")}`,
      reasons,
    };

    await this.log({
      scene: "rewrite",
      model: "rule-based-rewrite",
      inputSummary: `${body.title} / ${reasons.join(";")}`,
      output: result,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return result;
  }

  logs() {
    return this.prisma.aiCallLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  streamCreativeChat(body: CreativeChatRequest) {
    return this.creativeOrchestrator.streamCreativeChat(body);
  }

  directGenerate(body: DirectGenerateRequest) {
    return this.creativeOrchestrator.directGenerate(body);
  }

  generateTitles(body: TitleGenerateRequest) {
    return this.creativeOrchestrator.generateTitles(body);
  }

  rewriteSelection(body: SelectionRewriteRequest) {
    return this.creativeOrchestrator.rewriteSelection(body);
  }

  creativeImageConfigStatus() {
    return this.creativeOrchestrator.imageConfigStatus();
  }

  async creativeConversations(contentId: string, userId?: string) {
    const resolvedUserId = await this.contextBuilder.resolveUserId(userId);
    return this.conversations.listByContent({ userId: resolvedUserId, contentId });
  }

  async attachCreativeConversation(conversationId: string, body: { contentId: string; userId?: string }) {
    const resolvedUserId = await this.contextBuilder.resolveUserId(body.userId);
    const conversation = await this.conversations.attachToContent({
      conversationId,
      userId: resolvedUserId,
      contentId: body.contentId,
    });

    return { ok: true, conversationId: conversation.id, contentId: body.contentId };
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
        output: data.output as Prisma.InputJsonValue,
      },
    });
  }
}
