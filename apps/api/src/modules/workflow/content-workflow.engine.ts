import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AuditResult,
  ComplianceRewriteResult,
  ContentApprovalResult,
  ContentVisibility,
  CreativeChatRequest,
  DirectGenerateRequest,
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

const contentInclude = {
  author: true,
  assets: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
};

const QUALITY_COMPLIANCE_BACKSTOP_THRESHOLD = 8;
const QUALITY_COMPLIANCE_RISK_MARKERS = [
  "涉赌",
  "赌博",
  "博彩",
  "涉黄",
  "色情",
  "涉毒",
  "毒品",
  "违法",
  "违规",
  "诈骗",
  "引流",
  "隐私泄露",
  "未成年人",
  "合规性存在明显问题",
  "合规风险",
];

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
    private readonly contentQualitySkill: ContentQualityCapability
  ) {}

  rewriteText(body: { title: string; body: string; reasons?: string[] }) {
    return this.safetyReviewSkill.rewrite(body);
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

  directGenerate(body: DirectGenerateRequest) {
    return this.skillExecutor.runContentProductionLine(body, {
      userId: body.userId ?? "",
      contentId: body.contentId,
      source: "button",
    });
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
  async submitReview(userId: string, id: string) {
    const content = await this.getOwnedContent(userId, id);
    const result = await this.reviewAndPersist({
      contentId: id,
      title: content.title,
      body: content.body,
      updateStatus: true,
    });

    return {
      content: result.content,
      audit: result.audit,
      quality: result.quality,
      rewrite: result.rewrite,
    };
  }

  async runContentAudit(contentId: string) {
    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      throw new NotFoundException("content not found");
    }

    const result = await this.reviewAndPersist({
      contentId,
      title: content.title,
      body: content.body,
      updateStatus: false,
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

  async scoreQuality(userId: string, id: string): Promise<ContentApprovalResult> {
    const content = await this.getOwnedContent(userId, id);
    const allowed = new Set<DbContentStatus>([
      DbContentStatus.approved,
      DbContentStatus.updated,
      DbContentStatus.published,
      DbContentStatus.pending_review,
    ]);
    if (!allowed.has(content.status)) {
      throw new BadRequestException("content must pass safety review before quality scoring");
    }

    const quality = await this.contentQualitySkill.score({ title: content.title, body: content.body });
    const backstop = this.shouldRunQualityComplianceBackstop(quality)
      ? await this.runQualityComplianceBackstop(id, content.title, content.body)
      : null;

    if (backstop && !backstop.audit.passed) {
      const [, updated] = await this.prisma.$transaction([
        this.createQualityScoreRecord(id, quality),
        this.prisma.content.update({
          where: { id },
          data: {
            status: DbContentStatus.rejected,
            qualityScore: 0,
          },
          include: contentInclude,
        }),
      ]);

      return {
        content: toContentSummary(updated),
        quality,
      };
    }

    const nextStatus = content.status === DbContentStatus.pending_review ? DbContentStatus.approved : content.status;
    const [, updated] = await this.prisma.$transaction([
      this.createQualityScoreRecord(id, quality),
      this.prisma.content.update({
        where: { id },
        data: {
          status: nextStatus,
          qualityScore: quality.total,
        },
        include: contentInclude,
      }),
    ]);

    return {
      content: toContentSummary(updated),
      quality,
    };
  }

  async publish(userId: string, id: string, options: { scheduledAt?: string | null; visibility?: ContentVisibility } = {}) {
    const content = await this.getOwnedContent(userId, id);
    if (
      content.status !== DbContentStatus.approved &&
      content.status !== DbContentStatus.updated &&
      content.status !== DbContentStatus.pending_review &&
      content.status !== DbContentStatus.scheduled
    ) {
      throw new BadRequestException("content must be approved before publish");
    }

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

    return toContentSummary(updated);
  }

  private shouldRunQualityComplianceBackstop(quality: QualityScoreResult) {
    if (quality.dimensions.compliance <= QUALITY_COMPLIANCE_BACKSTOP_THRESHOLD) return true;
    const reason = quality.reason.toLowerCase();
    return QUALITY_COMPLIANCE_RISK_MARKERS.some((marker) => reason.includes(marker.toLowerCase()));
  }

  private async runQualityComplianceBackstop(contentId: string, title: string, body: string) {
    const { audit, rewrite } = await this.skillExecutor.runContentSafetyReviewer({ title, body });
    const auditRecord = await this.createAuditRecord(contentId, audit, rewrite);
    return { audit, rewrite, auditRecord };
  }

  private createAuditRecord(contentId: string, audit: AuditResult, rewrite: ComplianceRewriteResult | null) {
    return this.prisma.auditRecord.create({
      data: {
        contentId,
        passed: audit.passed,
        riskLevel: toDbAuditRiskLevel(audit.riskLevel),
        riskTypes: audit.riskTypes,
        reasons: audit.reasons,
        rawResponse: { audit, rewrite } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private createQualityScoreRecord(contentId: string, quality: QualityScoreResult) {
    return this.prisma.qualityScore.create({
      data: {
        contentId,
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

    return toContentSummary(updated);
  }

  // Workflow 负责业务状态和持久化；安全审核能力本身由 SafetyReviewCapability 提供。
  private async reviewAndPersist(input: {
    contentId: string;
    title: string;
    body: string;
    updateStatus: boolean;
  }) {
    const { audit, rewrite } = await this.skillExecutor.runContentSafetyReviewer({
      title: input.title,
      body: input.body,
    });
    const createAuditRecord = () => this.createAuditRecord(input.contentId, audit, rewrite);

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
        content: toContentSummary(updated),
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
      content: toContentSummary(content),
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

  private async assertOwnedContent(userId: string, id: string) {
    const count = await this.prisma.content.count({ where: { id, authorId: userId } });
    if (count === 0) {
      throw new NotFoundException("content not found");
    }
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
