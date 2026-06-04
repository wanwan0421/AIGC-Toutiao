import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ContentApprovalResult,
  CreativeChatRequest,
  DirectGenerateRequest,
  SelectionRewriteRequest,
  TitleGenerateRequest,
} from "@aicp/shared";
import { ContentStatus as DbContentStatus, Prisma } from "@prisma/client";
import { toContentSummary, toDbAuditRiskLevel } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { ContextBuilderService } from "../ai/context-builder.service";
import { ConversationArchiveService } from "../ai/conversation-archive.service";
import { ContentQualitySkill } from "../ai/skills/content-quality.skill";
import { CreativeAssistantSkill } from "../ai/skills/creative-assistant.skill";
import { CreativeProductionSkill } from "../ai/skills/creative-production.skill";
import { SafetyReviewSkill } from "../ai/skills/safety-review.skill";

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
    private readonly productionSkill: CreativeProductionSkill,
    private readonly assistantSkill: CreativeAssistantSkill,
    private readonly contextBuilder: ContextBuilderService,
    private readonly conversations: ConversationArchiveService,
    private readonly safetyReviewSkill: SafetyReviewSkill,
    private readonly contentQualitySkill: ContentQualitySkill
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
    return this.productionSkill.directGenerate(body);
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
    const { audit, rewrite } = await this.safetyReviewSkill.reviewWithRewrite(body);
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

    // 质量评分只为推荐/分发提供参考，不参与安全审核是否通过。
    const quality = await this.contentQualitySkill.score({ title: content.title, body: content.body });
    const nextStatus = content.status === DbContentStatus.pending_review ? DbContentStatus.approved : content.status;
    const [, updated] = await this.prisma.$transaction([
      this.prisma.qualityScore.create({
        data: {
          contentId: id,
          total: quality.total,
          dimensions: quality.dimensions as unknown as Prisma.InputJsonValue,
          reason: quality.reason,
          rawResponse: quality as unknown as Prisma.InputJsonValue,
        },
      }),
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

  async publish(userId: string, id: string) {
    const content = await this.getOwnedContent(userId, id);
    if (
      content.status !== DbContentStatus.approved &&
      content.status !== DbContentStatus.updated &&
      content.status !== DbContentStatus.pending_review
    ) {
      throw new BadRequestException("content must be approved before publish");
    }

    const updated = await this.prisma.content.update({
      where: { id },
      data: {
        status: DbContentStatus.published,
        publishedAt: new Date(),
      },
      include: contentInclude,
    });

    return toContentSummary(updated);
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

  // Workflow 负责业务状态和持久化；安全审核能力本身由 SafetyReviewSkill 提供。
  private async reviewAndPersist(input: {
    contentId: string;
    title: string;
    body: string;
    updateStatus: boolean;
  }) {
    const { audit, rewrite } = await this.safetyReviewSkill.reviewWithRewrite({
      title: input.title,
      body: input.body,
    });
    const createAuditRecord = () =>
      this.prisma.auditRecord.create({
        data: {
          contentId: input.contentId,
          passed: audit.passed,
          riskLevel: toDbAuditRiskLevel(audit.riskLevel),
          riskTypes: audit.riskTypes,
          reasons: audit.reasons,
          rawResponse: { audit, rewrite } as unknown as Prisma.InputJsonValue,
        },
      });

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
}
