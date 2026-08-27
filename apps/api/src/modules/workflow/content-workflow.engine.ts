import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AuditResult,
  ComplianceRewriteResult,
  ContentApprovalResult,
  ContentVisibility,
  CreativeChatRequest,
  QualityScoreResult,
  SelectionRewriteRequest,
  TitleGenerateRequest,
} from "@aicp/shared";
import { ContentStatus as DbContentStatus, ContentVisibility as DbContentVisibility, Prisma } from "@prisma/client";
import { toContentSummary, toDbAuditRiskLevel } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { ContextBuilderService } from "../ai/context-builder.service";
import { ConversationArchiveService } from "../ai/conversation-archive.service";
import { CreativeAssistantUseCase } from "../ai/application/creative-assistant.use-case";
import { ContentSafetyUseCase } from "../ai/application/content-safety.use-case";
import { ImageGenerationService } from "../ai/image-generation.service";
import { QualityScoringAgent } from "../ai/agents/quality-scoring.agent";
import { ContentHeatScoreService } from "../content-metrics/content-heat-score.service";
import { ContentReviewPolicyService } from "./content-review-policy.service";
import { AppError } from "../../common/app-error";

const contentInclude = {
  author: true,
  assets: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
};

@Injectable()
export class ContentWorkflowEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGeneration: ImageGenerationService,
    private readonly assistant: CreativeAssistantUseCase,
    private readonly contextBuilder: ContextBuilderService,
    private readonly conversations: ConversationArchiveService,
    private readonly contentSafety: ContentSafetyUseCase,
    private readonly qualityScoring: QualityScoringAgent,
    private readonly reviewPolicy: ContentReviewPolicyService,
    private readonly heatScores: ContentHeatScoreService
  ) {}

  rewriteText(body: { title: string; body: string; reasons?: string[] }, options: { signal?: AbortSignal; aiJobId?: string; contentId?: string; conversationId?: string } = {}) {
    return this.contentSafety.rewrite(body, options);
  }

  logs() {
    return this.prisma.aiCallLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  streamCreativeChat(body: CreativeChatRequest, options: { signal?: AbortSignal; aiJobId?: string; assistantMessageId?: string } = {}) {
    return this.assistant.streamChat(body, options);
  }

  generateTitles(body: TitleGenerateRequest, options: { signal?: AbortSignal; aiJobId?: string; contentId?: string; conversationId?: string } = {}) {
    return this.assistant.generateTitles(body, options);
  }

  rewriteSelection(body: SelectionRewriteRequest, options: { signal?: AbortSignal; aiJobId?: string; contentId?: string; conversationId?: string } = {}) {
    return this.assistant.rewriteSelection(body, options);
  }

  creativeImageConfigStatus() {
    return this.imageGeneration.configStatus();
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

  // 提交审核，审核不通过则更新状态为 rejected，并返回审核结果和改写建议；审核通过则更新状态为 approved。
  async submitReview(userId: string, id: string, options: { signal?: AbortSignal; aiJobId?: string } = {}) {
    const content = await this.getOwnedContent(userId, id);
    const result = await this.reviewAndPersist({
      contentId: id,
      title: content.title,
      body: content.body,
      contentHash: this.reviewPolicy.computeContentReviewHash(content),
      updateStatus: true,
      signal: options.signal,
      aiJobId: options.aiJobId,
    });

    return {
      content: result.content,
      audit: result.audit,
      quality: result.quality,
      rewrite: result.rewrite,
    };
  }

  async runContentAudit(userId: string, contentId: string, options: { signal?: AbortSignal; aiJobId?: string } = {}) {
    const content = await this.prisma.content.findFirst({ where: { id: contentId, authorId: userId }, include: contentInclude });
    if (!content) {
      throw new NotFoundException("content not found");
    }

    const result = await this.reviewAndPersist({
      contentId,
      title: content.title,
      body: content.body,
      contentHash: this.reviewPolicy.computeContentReviewHash(content),
      updateStatus: false,
      signal: options.signal,
      aiJobId: options.aiJobId,
    });

    return {
      contentId,
      audit: result.auditRecord,
      quality: result.qualityRecord,
      rewrite: result.rewrite,
      checkedAt: result.auditRecord.createdAt.toISOString(),
    };
  }

  async checkText(body: { title: string; body: string }, options: { signal?: AbortSignal; aiJobId?: string; contentId?: string; conversationId?: string } = {}) {
    const { audit, rewrite } = await this.contentSafety.reviewWithRewrite(body, options);
    return {
      audit,
      quality: null,
      rewrite,
      checkedAt: new Date().toISOString(),
    };
  }

  async approve(userId: string, id: string): Promise<ContentApprovalResult> {
    return this.scoreQuality(userId, id);
  }

  async scoreQuality(userId: string, id: string, options: { signal?: AbortSignal; aiJobId?: string } = {}): Promise<ContentApprovalResult> {
    let content = await this.getOwnedContent(userId, id);
    const allowed = new Set<DbContentStatus>([
      DbContentStatus.approved,
      DbContentStatus.updated,
      DbContentStatus.published,
      DbContentStatus.scheduled,
    ]);

    const auditState = await this.reviewPolicy.getCurrentAuditState(content);
    if (!auditState.valid) {
      throw this.qualityAuditRequiredError(auditState.reason);
    }

    if (!allowed.has(content.status)) {
      const recoverableStatus = content.status === DbContentStatus.draft || content.status === DbContentStatus.pending_review;
      if (!recoverableStatus) {
        throw new AppError({
          code: "CONTENT_STATUS_NOT_SCORABLE",
          message: "当前内容状态不允许进行质量评估",
          statusCode: 409,
          retryable: false,
          details: { contentId: id, status: content.status },
        });
      }

      const restored = await this.prisma.content.updateMany({
        where: {
          id,
          authorId: userId,
          status: content.status,
          updatedAt: content.updatedAt,
        },
        data: { status: DbContentStatus.approved },
      });
      if (restored.count === 0) {
        throw new AppError({
          code: "CONTENT_CHANGED_AFTER_REVIEW",
          message: "内容状态已发生变化，请重新进行内容安全审核",
          statusCode: 409,
          retryable: false,
          details: { contentId: id },
        });
      }
      content = await this.getOwnedContent(userId, id);
      await this.reviewPolicy.assertCurrentContentAuditPassed(content);
    }

    const existing = options.aiJobId
      ? await this.prisma.qualityScore.findUnique({ where: { aiJobId: options.aiJobId } })
      : null;
    if (existing) {
      return {
        content: await this.toNormalizedContentSummary(content),
        quality: this.qualityResultFromRecord(existing),
      };
    }
    const quality = await this.qualityScoring.run(
      { title: content.title, body: content.body },
      { signal: options.signal, aiJobId: options.aiJobId, contentId: id }
    );

    const [, updated] = await this.prisma.$transaction([
      this.createQualityScoreRecord(id, quality, options.aiJobId),
      this.prisma.content.update({
        where: { id },
        data: {
          qualityScore: quality.total,
        },
        include: contentInclude,
      }),
    ]);

    return {
      content: await this.toNormalizedContentSummary(updated),
      quality,
    };
  }

  // 根据审核结果和改写建议创建审核记录
  private qualityAuditRequiredError(reason?: string) {
    if (reason === "CONTENT_REJECTED") {
      return new AppError({
        code: reason,
        message: "内容安全审核未通过，请修改后重新审核",
        statusCode: 409,
        retryable: false,
      });
    }
    if (reason === "CONTENT_CHANGED_AFTER_REVIEW") {
      return new AppError({
        code: reason,
        message: "内容在审核后发生了变化，请重新进行内容安全审核",
        statusCode: 409,
        retryable: false,
      });
    }
    return new AppError({
      code: reason ?? "AUDIT_REQUIRED_BEFORE_QUALITY_SCORE",
      message: "请先完成并通过内容安全审核，再进行质量评估",
      statusCode: 409,
      retryable: false,
    });
  }

  async publish(userId: string, id: string, options: { scheduledAt?: string | null; visibility?: ContentVisibility } = {}) {
    const content = await this.getOwnedContent(userId, id);
    await this.reviewPolicy.assertPublishableForCurrentContent(content);

    const scheduledAt = this.parseScheduledAt(options.scheduledAt);
    const visibility = this.parseVisibility(options.visibility);
    const now = new Date();
    const shouldSchedule = scheduledAt !== undefined && scheduledAt !== null && scheduledAt.getTime() > now.getTime();

    const updated = await this.prisma.content.update({
      where: { id },
      data: {
        status: shouldSchedule ? DbContentStatus.scheduled : DbContentStatus.published,
        publishedAt: shouldSchedule ? null : now,
        scheduledAt: shouldSchedule ? scheduledAt : null,
        visibility,
      },
      include: contentInclude,
    });

    return this.toNormalizedContentSummary(updated);
  }

  private createAuditRecord(
    contentId: string,
    contentHash: string,
    audit: AuditResult,
    rewrite: ComplianceRewriteResult | null,
    aiJobId?: string
  ) {
    return this.prisma.auditRecord.create({
      data: {
        contentId,
        aiJobId,
        contentHash,
        passed: audit.passed,
        riskLevel: toDbAuditRiskLevel(audit.riskLevel),
        riskTypes: audit.riskTypes,
        reasons: audit.reasons,
        rawResponse: { audit, rewrite } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private createQualityScoreRecord(contentId: string, quality: QualityScoreResult, aiJobId?: string) {
    return this.prisma.qualityScore.create({
      data: {
        contentId,
        aiJobId,
        total: quality.total,
        dimensions: quality.dimensions as unknown as Prisma.InputJsonValue,
        reason: quality.reason,
        rawResponse: quality as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async offline(userId: string, id: string) {
    await this.assertOwnedContent(userId, id);
    const updated = await this.prisma.content.update({
      where: { id },
      data: { status: DbContentStatus.offline },
      include: contentInclude,
    });

    return this.toNormalizedContentSummary(updated);
  }

  // Workflow 负责业务状态和持久化；安全审核由 ContentSafetyUseCase 提供。
  private async reviewAndPersist(input: {
    contentId: string;
    title: string;
    body: string;
    contentHash: string;
    updateStatus: boolean;
    signal?: AbortSignal;
    aiJobId?: string;
  }) {
    if (input.aiJobId) {
      const existing = await this.prisma.auditRecord.findUnique({ where: { aiJobId: input.aiJobId } });
      if (existing) {
        const content = await this.prisma.content.findUnique({ where: { id: input.contentId }, include: contentInclude });
        if (!content) throw new NotFoundException("content not found");
        const audit = this.auditResultFromRecord(existing);
        return {
          content: await this.toNormalizedContentSummary(content),
          audit,
          quality: null,
          rewrite: audit.passed ? null : this.rewriteFromAuditRecord(existing),
          auditRecord: existing,
          qualityRecord: null,
        };
      }
    }
    const { audit, rewrite } = await this.contentSafety.reviewWithRewrite({
      title: input.title,
      body: input.body,
    }, { signal: input.signal, aiJobId: input.aiJobId, contentId: input.contentId });
    const createAuditRecord = () => this.createAuditRecord(input.contentId, input.contentHash, audit, rewrite, input.aiJobId);

    const contentUpdateData = !audit.passed
      ? input.updateStatus
        ? { qualityScore: 0, status: DbContentStatus.rejected }
        : null
      : input.updateStatus
        ? { status: DbContentStatus.approved }
        : null;

    if (contentUpdateData) {
      const [auditRecord, updated] = await this.prisma.$transaction([
        createAuditRecord(),
        this.prisma.content.update({
          where: { id: input.contentId },
          data: contentUpdateData,
          include: contentInclude,
        }),
      ]);

      return {
        content: await this.toNormalizedContentSummary(updated),
        audit,
        quality: null,
        rewrite: audit.passed ? null : rewrite,
        auditRecord,
        qualityRecord: null,
      };
    }

    const [auditRecord, content] = await this.prisma.$transaction([
      createAuditRecord(),
      this.prisma.content.findUnique({
        where: { id: input.contentId },
        include: contentInclude,
      }),
    ]);
    if (!content) {
      throw new NotFoundException("content not found");
    }

    return {
      content: await this.toNormalizedContentSummary(content),
      audit,
      quality: null,
      rewrite: audit.passed ? null : rewrite,
      auditRecord,
      qualityRecord: null,
    };
  }

  private async getOwnedContent(userId: string, id: string) {
    const content = await this.prisma.content.findUnique({
      where: { id },
      include: contentInclude,
    });

    if (!content || content.authorId !== userId) {
      throw new NotFoundException("content not found");
    }

    return content;
  }

  private async toNormalizedContentSummary<T extends Parameters<ContentHeatScoreService["normalizeContent"]>[0]>(
    content: T
  ) {
    return toContentSummary(
      (await this.heatScores.normalizeContent(content)) as unknown as Parameters<typeof toContentSummary>[0]
    );
  }

  private async assertOwnedContent(userId: string, id: string) {
    const count = await this.prisma.content.count({ where: { id, authorId: userId } });
    if (count === 0) {
      throw new NotFoundException("content not found");
    }
  }

  private auditResultFromRecord(record: {
    passed: boolean;
    riskLevel: string;
    riskTypes: string[];
    reasons: string[];
    rawResponse: Prisma.JsonValue | null;
  }): AuditResult {
    const raw = this.record(record.rawResponse);
    const audit = this.record(raw?.audit);
    if (audit && typeof audit.passed === "boolean" && Array.isArray(audit.riskItems)) {
      return audit as unknown as AuditResult;
    }
    return {
      passed: record.passed,
      riskLevel: record.riskLevel as AuditResult["riskLevel"],
      riskTypes: record.riskTypes as AuditResult["riskTypes"],
      reasons: record.reasons,
      rewriteAvailable: !record.passed,
      riskItems: [],
      categoryScores: {},
    };
  }

  private rewriteFromAuditRecord(record: { rawResponse: Prisma.JsonValue | null }) {
    const rewrite = this.record(this.record(record.rawResponse)?.rewrite);
    return rewrite && typeof rewrite.title === "string" && typeof rewrite.body === "string"
      ? (rewrite as unknown as ComplianceRewriteResult)
      : null;
  }

  private qualityResultFromRecord(record: {
    total: number;
    dimensions: Prisma.JsonValue;
    reason: string;
    rawResponse: Prisma.JsonValue | null;
  }): QualityScoreResult {
    const raw = this.record(record.rawResponse);
    const dimensions = this.record(raw?.dimensions) ?? this.record(record.dimensions) ?? {};
    return {
      total: typeof raw?.total === "number" ? raw.total : record.total,
      dimensions: {
        structure: this.scoreNumber(dimensions.structure),
        clarity: this.scoreNumber(dimensions.clarity),
        value: this.scoreNumber(dimensions.value),
        attraction: this.scoreNumber(dimensions.attraction),
        compliance: this.scoreNumber(dimensions.compliance),
      },
      reason: typeof raw?.reason === "string" ? raw.reason : record.reason,
    };
  }

  private record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  }

  private scoreNumber(value: unknown) {
    const parsed = typeof value === "number" ? value : Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private parseScheduledAt(value: string | null | undefined) {
    if (value === undefined) return undefined;
    if (value === null || !value.trim()) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("invalid scheduledAt");
    }
    return date;
  }

  private parseVisibility(value: ContentVisibility | undefined) {
    if (value === undefined) return undefined;
    if (value === "public" || value === "followers" || value === "private") {
      return value as DbContentVisibility;
    }
    throw new BadRequestException("invalid visibility");
  }
}
