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
import { SkillExecutorService } from "../ai/skills-runtime/skill-executor.service";
import { ContentQualityCapability } from "../ai/capabilities/content-quality.capability";
import { CreativeAssistantCapability } from "../ai/capabilities/creative-assistant.capability";
import { CreativeProductionCapability } from "../ai/capabilities/creative-production.capability";
import { SafetyReviewCapability } from "../ai/capabilities/safety-review.capability";
import { ContentHeatScoreService } from "../content-metrics/content-heat-score.service";
import { ContentReviewPolicyService } from "./content-review-policy.service";

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
    private readonly productionSkill: CreativeProductionCapability,
    private readonly assistantSkill: CreativeAssistantCapability,
    private readonly contextBuilder: ContextBuilderService,
    private readonly conversations: ConversationArchiveService,
    private readonly skillExecutor: SkillExecutorService,
    private readonly safetyReviewSkill: SafetyReviewCapability,
    private readonly contentQualitySkill: ContentQualityCapability,
    private readonly reviewPolicy: ContentReviewPolicyService,
    private readonly heatScores: ContentHeatScoreService
  ) {}

  rewriteText(body: { title: string; body: string; reasons?: string[] }, options: { signal?: AbortSignal } = {}) {
    return this.safetyReviewSkill.rewrite(body, options);
  }

  logs() {
    return this.prisma.aiCallLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  streamCreativeChat(body: CreativeChatRequest) {
    return this.assistantSkill.streamChat(body);
  }

  generateTitles(body: TitleGenerateRequest) {
    return this.assistantSkill.generateTitles(body);
  }

  rewriteSelection(body: SelectionRewriteRequest) {
    return this.assistantSkill.rewriteSelection(body);
  }

  creativeImageConfigStatus() {
    return this.productionSkill.imageConfigStatus();
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

  async runContentAudit(contentId: string, options: { signal?: AbortSignal; aiJobId?: string } = {}) {
    const content = await this.prisma.content.findUnique({ where: { id: contentId }, include: contentInclude });
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

  async checkText(body: { title: string; body: string }) {
    const { audit, rewrite } = await this.skillExecutor.runContentSafetyReviewer(body);
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
    const content = await this.getOwnedContent(userId, id);
    const allowed = new Set<DbContentStatus>([
      DbContentStatus.approved,
      DbContentStatus.updated,
      DbContentStatus.published,
      DbContentStatus.scheduled,
    ]);
    if (!allowed.has(content.status)) {
      throw new BadRequestException("content must pass safety review before quality scoring");
    }
    await this.reviewPolicy.assertCurrentContentAuditPassed(content);

    const existing = options.aiJobId
      ? await this.prisma.qualityScore.findUnique({ where: { aiJobId: options.aiJobId } })
      : null;
    if (existing) {
      return {
        content: await this.toNormalizedContentSummary(content),
        quality: this.qualityResultFromRecord(existing),
      };
    }
    const quality = await this.contentQualitySkill.score({ title: content.title, body: content.body }, { signal: options.signal });

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

  // Workflow 负责业务状态和持久化；安全审核能力本身由 SafetyReviewCapability 提供。
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
    const { audit, rewrite } = await this.skillExecutor.runContentSafetyReviewer({
      title: input.title,
      body: input.body,
    }, { signal: input.signal });
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
