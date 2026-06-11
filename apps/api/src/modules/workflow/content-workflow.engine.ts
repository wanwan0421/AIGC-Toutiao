import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRiskLevel } from "@aicp/shared";
import type {
  AuditResult,
  AuditRiskItem,
  AuditRiskType,
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
type QualityComplianceSignal = {
  type: Exclude<AuditRiskType, "none">;
  markers: string[];
  reason: string;
  suggestion: string;
};

const QUALITY_COMPLIANCE_SIGNALS: QualityComplianceSignal[] = [
  {
    type: "gambling",
    markers: ["涉赌", "赌博", "博彩", "诱导参与赌博", "投注", "下注", "私彩", "赌球"],
    reason: "质量评估识别到涉赌宣传或赌博引流风险",
    suggestion: "删除赌博玩法、投注引导、收益承诺和站外引流内容",
  },
  {
    type: "pornography",
    markers: ["涉黄", "色情", "色情网站", "黄色网站", "成人网站", "约炮", "裸聊", "涉黄引流"],
    reason: "质量评估识别到涉黄内容或色情网站引流风险",
    suggestion: "删除色情描述、色情网站访问引导和相关站外引流内容",
  },
  {
    type: "drug",
    markers: ["涉毒", "毒品", "贩毒", "吸毒"],
    reason: "质量评估识别到涉毒风险",
    suggestion: "删除毒品相关交易、使用或引导表达",
  },
  {
    type: "illegal",
    markers: ["违法", "违规内容", "违法交易", "违禁", "黑产"],
    reason: "质量评估识别到违法或违禁风险",
    suggestion: "删除违法交易、违禁服务或黑产相关表达",
  },
  {
    type: "fraud",
    markers: ["诈骗", "欺诈", "刷单", "返利", "稳赚", "拉人头"],
    reason: "质量评估识别到诈骗或欺诈风险",
    suggestion: "删除诈骗诱导、虚假收益承诺和欺诈性转化内容",
  },
  {
    type: "privacy",
    markers: ["隐私泄露", "身份证", "手机号", "银行卡"],
    reason: "质量评估识别到隐私泄露风险",
    suggestion: "删除个人身份、联系方式、账户等隐私信息",
  },
  {
    type: "minor",
    markers: ["未成年人", "未成年"],
    reason: "质量评估识别到未成年人安全风险",
    suggestion: "删除可能伤害未成年人安全的内容",
  },
  {
    type: "sensitive",
    markers: ["合规性存在明显问题", "合规性存在严重问题", "合规风险", "不合规内容"],
    reason: "质量评估识别到明确合规风险",
    suggestion: "删除或重写质量评估指出的不合规表达",
  },
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
    const qualityComplianceSignals = this.qualityComplianceSignals(quality);
    const backstop = this.shouldRunQualityComplianceBackstop(quality, qualityComplianceSignals)
      ? await this.runQualityComplianceBackstop(id, content.title, content.body)
      : null;
    const syntheticAudit =
      backstop?.audit.passed && qualityComplianceSignals.length
        ? this.auditFromQualityComplianceSignals(quality, content.title, content.body, qualityComplianceSignals)
        : null;

    if (backstop && (!backstop.audit.passed || syntheticAudit)) {
      const updateContent = this.prisma.content.update({
        where: { id },
        data: {
          status: DbContentStatus.rejected,
          qualityScore: 0,
        },
        include: contentInclude,
      });
      const results = syntheticAudit
        ? await this.prisma.$transaction([
            this.createQualityScoreRecord(id, quality),
            this.createAuditRecord(id, syntheticAudit, null),
            updateContent,
          ])
        : await this.prisma.$transaction([this.createQualityScoreRecord(id, quality), updateContent]);
      const updated = results.at(-1);

      return {
        content: toContentSummary(updated as Awaited<typeof updateContent>),
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

  private shouldRunQualityComplianceBackstop(quality: QualityScoreResult, signals = this.qualityComplianceSignals(quality)) {
    if (quality.dimensions.compliance <= QUALITY_COMPLIANCE_BACKSTOP_THRESHOLD) return true;
    return signals.length > 0;
  }

  private qualityComplianceSignals(quality: QualityScoreResult) {
    const reason = quality.reason.toLowerCase();
    return QUALITY_COMPLIANCE_SIGNALS.filter((signal) =>
      signal.markers.some((marker) => reason.includes(marker.toLowerCase()))
    );
  }

  private auditFromQualityComplianceSignals(
    quality: QualityScoreResult,
    title: string,
    body: string,
    signals: QualityComplianceSignal[]
  ): AuditResult {
    const riskItems = signals.map((signal, index) => this.qualityRiskItem(signal, index, title, body));
    const riskTypes = Array.from(new Set(signals.map((signal) => signal.type)));
    const categoryScores = Object.fromEntries(riskTypes.map((type) => [type, 0.92])) as AuditResult["categoryScores"];

    return {
      passed: false,
      riskLevel: AuditRiskLevel.High,
      riskTypes,
      reasons: Array.from(new Set([...signals.map((signal) => signal.reason), quality.reason])).slice(0, 8),
      rewriteAvailable: true,
      riskItems,
      categoryScores,
    };
  }

  private qualityRiskItem(signal: QualityComplianceSignal, index: number, title: string, body: string): AuditRiskItem {
    const located = this.locateQualityRiskEvidence(signal, title, body);
    return {
      id: `quality_backstop_${index + 1}`,
      type: signal.type,
      severity: "high",
      confidence: 0.92,
      evidence: located.evidence,
      reason: signal.reason,
      source: "llm",
      field: located.field,
      startOffset: located.startOffset,
      endOffset: located.endOffset,
      suggestion: signal.suggestion,
    };
  }

  private locateQualityRiskEvidence(
    signal: QualityComplianceSignal,
    title: string,
    body: string
  ): { field: "title" | "body"; evidence: string; startOffset?: number; endOffset?: number } {
    const fields = [
      { field: "body" as const, text: body },
      { field: "title" as const, text: title },
    ];

    for (const current of fields) {
      const lowerText = current.text.toLowerCase();
      const marker = signal.markers.find((item) => lowerText.includes(item.toLowerCase()));
      if (marker) {
        const index = lowerText.indexOf(marker.toLowerCase());
        const startOffset = Math.max(0, index - 24);
        const endOffset = Math.min(current.text.length, index + Math.max(marker.length, 48));
        return {
          field: current.field,
          evidence: current.text.slice(startOffset, endOffset),
          startOffset,
          endOffset,
        };
      }
    }

    const fallback = body.trim() ? { field: "body" as const, text: body } : { field: "title" as const, text: title };
    return {
      field: fallback.field,
      evidence: "全文",
    };
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
