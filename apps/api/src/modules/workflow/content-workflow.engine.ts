import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  AuditResult,
  AuditRiskType,
  ComplianceRewriteResult,
  ContentApprovalResult,
  ContentVisibility,
  CreativeChatRequest,
  QualityScoreResult,
  SelectionRewriteRequest,
  TitleGenerateRequest,
} from "@aicp/shared";
import { AssetAuditStatus, ContentStatus as DbContentStatus, ContentVisibility as DbContentVisibility, Prisma } from "@prisma/client";
import { toContentSummary, toDbAuditRiskLevel } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { WritingSkillService } from "../ai/writing-skill.service";
import { ContextBuilderService } from "../ai/context-builder.service";
import { ConversationArchiveService } from "../ai/conversation-archive.service";
import { CreativeAssistantUseCase } from "../ai/application/creative-assistant.use-case";
import { ContentSafetyUseCase } from "../ai/application/content-safety.use-case";
import { ImageGenerationService } from "../ai/image-generation.service";
import { QualityScoringAgent } from "../ai/agents/quality-scoring.agent";
import { ContentHeatScoreService } from "../content-metrics/content-heat-score.service";
import { CONTENT_REVIEW_POLICY_VERSION, ContentReviewPolicyService } from "./content-review-policy.service";
import { AppError } from "../../common/app-error";
import { validateArticleText } from "../../common/article-length-policy";
import { ImageModerationService } from "../assets/image-moderation.service";
import { StorageService } from "../storage/storage.service";

const contentInclude = {
  author: true,
  assets: {
    include: { asset: true },
    orderBy: { sortOrder: "asc" as const },
  },
};

type SettledValue<T> = { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown };

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<Array<SettledValue<R>>> {
  const results: Array<SettledValue<R>> = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = { status: "fulfilled", value: await work(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }));
  return results;
}

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
    private readonly heatScores: ContentHeatScoreService,
    private readonly imageModeration: ImageModerationService,
    private readonly storage: StorageService,
    @Optional() private readonly writingSkill?: WritingSkillService
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

  streamCreativeChat(body: CreativeChatRequest, options: { signal?: AbortSignal; aiJobId?: string; assistantMessageId?: string; assertMaterialsCurrent?: () => Promise<void> } = {}) {
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
    const sourceContent = await this.getOwnedContent(userId, id);
    const { content, imageFiles } = await this.prepareReviewSnapshot(sourceContent);
    const result = await this.reviewAndPersist({
      contentId: id,
      title: content.title,
      body: content.body,
      contentHash: this.reviewPolicy.computeContentReviewHash(content),
      imageAssets: content.assets.map(({ asset }) => asset),
      imageFiles,
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

    const { content: reviewContent, imageFiles } = await this.prepareReviewSnapshot(content);
    const result = await this.reviewAndPersist({
      contentId,
      title: content.title,
      body: content.body,
      contentHash: this.reviewPolicy.computeContentReviewHash(reviewContent),
      imageAssets: reviewContent.assets.map(({ asset }) => asset),
      imageFiles,
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
    validateArticleText({
      title: content.title,
      body: content.body,
      bodyHtml: content.bodyHtml,
      bodyJson: content.bodyJson && typeof content.bodyJson === "object" && !Array.isArray(content.bodyJson)
        ? content.bodyJson as Record<string, unknown> : null,
    });
    await this.reviewPolicy.assertPublishableForCurrentContent(content);

    const scheduledAt = this.parseScheduledAt(options.scheduledAt);
    const visibility = this.parseVisibility(options.visibility);
    const now = new Date();
    const shouldSchedule = scheduledAt !== undefined && scheduledAt !== null && scheduledAt.getTime() > now.getTime();

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.content.updateMany({
        where: { id, authorId: userId, status: content.status, updatedAt: content.updatedAt },
        data: {
          status: shouldSchedule ? DbContentStatus.scheduled : DbContentStatus.published,
          publishedAt: shouldSchedule ? null : now,
          scheduledAt: shouldSchedule ? scheduledAt : null,
          visibility,
        },
      });
      if (changed.count === 0) throw new AppError({
        code: "CONTENT_CHANGED_AFTER_REVIEW", message: "内容在发布前发生变化，请重新审核后重试", statusCode: 409,
      });
      const persisted = await tx.content.findUniqueOrThrow({ where: { id }, include: contentInclude });
      await this.writingSkill?.syncPublishedContent(tx, persisted);
      return persisted;
    });
    return this.toNormalizedContentSummary(updated);
  }

  private createAuditRecord(
    contentId: string,
    contentHash: string,
    audit: AuditResult,
    rewrite: ComplianceRewriteResult | null,
    aiJobId?: string,
    imageAudits: Array<{ assetId: string; fileName: string; auditStatus: AssetAuditStatus; auditReason: string | null; riskLevel: string; riskTypes: string[] }> = [],
    existingRecordId?: string,
  ) {
    const data = {
      contentId,
      aiJobId,
      contentHash,
      passed: audit.passed,
      riskLevel: toDbAuditRiskLevel(audit.riskLevel),
      riskTypes: audit.riskTypes,
      reasons: audit.reasons,
      rawResponse: { audit, rewrite, imageAudits } as unknown as Prisma.InputJsonValue,
    };
    return existingRecordId
      ? this.prisma.auditRecord.update({ where: { id: existingRecordId }, data })
      : this.prisma.auditRecord.create({ data });
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
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.writingSkill?.invalidateContent(tx, id);
      return tx.content.update({ where: { id }, data: { status: DbContentStatus.offline }, include: contentInclude });
    });

    return this.toNormalizedContentSummary(updated);
  }

  private async prepareReviewSnapshot<T extends { assets: Array<{ asset: { id: string; fileName: string; mimeType: string; metadata: Prisma.JsonValue } }> }>(content: T) {
    const imageFiles: Array<{ assetId: string; buffer: Buffer; sha256: string }> = [];
    const refreshedAssets = [] as T["assets"];
    for (const relation of content.assets) {
      const asset = relation.asset;
      if (!asset.mimeType.toLowerCase().startsWith("image/")) {
        refreshedAssets.push(relation);
        continue;
      }
      const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
        ? asset.metadata as Record<string, unknown>
        : {};
      const storageKey = typeof metadata.storageKey === "string" ? metadata.storageKey : undefined;
      if (!storageKey) {
        throw new AppError({ code: "IMAGE_STORAGE_UNAVAILABLE", message: `图片素材“${asset.fileName}”无法读取，请重新上传后再审核`, statusCode: 422 });
      }
      let buffer: Buffer;
      try {
        buffer = await this.storage.readBuffer(storageKey);
      } catch {
        throw new AppError({ code: "IMAGE_STORAGE_UNAVAILABLE", message: `图片素材“${asset.fileName}”无法读取，请重新上传后再审核`, statusCode: 422 });
      }
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const nextMetadata = { ...metadata, imageSha256: sha256 } as Prisma.InputJsonValue;
      if (metadata.imageSha256 !== sha256) {
        await this.prisma.asset.update({ where: { id: asset.id }, data: { metadata: nextMetadata } });
      }
      imageFiles.push({ assetId: asset.id, buffer, sha256 });
      refreshedAssets.push({ ...relation, asset: { ...asset, metadata: nextMetadata } } as T["assets"][number]);
    }
    return { content: { ...content, assets: refreshedAssets } as T, imageFiles };
  }

  // Workflow 负责业务状态和持久化；安全审核由 ContentSafetyUseCase 提供。
  private async reviewAndPersist(input: {
    contentId: string;
    title: string;
    body: string;
    contentHash: string;
    imageAssets: Array<{ id: string; fileName: string; mimeType: string; metadata: Prisma.JsonValue; auditStatus: AssetAuditStatus }>;
    imageFiles: Array<{ assetId: string; buffer: Buffer; sha256: string }>;
    updateStatus: boolean;
    signal?: AbortSignal;
    aiJobId?: string;
  }) {
    let existingAuditRecordId: string | undefined;
    const cached = await this.prisma.auditRecord.findFirst({
      where: { contentId: input.contentId, contentHash: input.contentHash },
      orderBy: { createdAt: "desc" },
    });
    const cachedImageAudits = cached ? this.currentImageAudits(cached, input.imageFiles, input.imageAssets) : null;
    if (cached && cachedImageAudits) {
      let content = await this.prisma.content.findUnique({ where: { id: input.contentId }, include: contentInclude });
      if (!content) throw new NotFoundException("content not found");
      const audit = this.auditResultFromRecord(cached);
      const existingJobAudit = input.aiJobId
        ? await this.prisma.auditRecord.findUnique({ where: { aiJobId: input.aiJobId } })
        : null;
      let promotedAuditRecord = existingJobAudit?.contentHash === input.contentHash ? existingJobAudit : null;
      const reaffirmedAuditRecord = existingJobAudit?.contentHash === input.contentHash
        ? null
        : this.prisma.auditRecord.create({
            data: {
              contentId: input.contentId,
              ...(input.aiJobId && !existingJobAudit ? { aiJobId: input.aiJobId } : {}),
              contentHash: input.contentHash,
              passed: cached.passed,
              riskLevel: cached.riskLevel,
              riskTypes: cached.riskTypes,
              reasons: cached.reasons,
              rawResponse: (cached.rawResponse ?? {}) as Prisma.InputJsonValue,
            },
          });
      const imageAuditUpdates = cachedImageAudits.map((item) => this.prisma.asset.update({
        where: { id: item.assetId },
        data: { auditStatus: item.auditStatus, auditReason: item.auditReason, riskLevel: item.riskLevel, riskTypes: item.riskTypes },
      }));
      if (input.updateStatus) {
        const results = await this.prisma.$transaction([
          ...imageAuditUpdates,
          ...(reaffirmedAuditRecord ? [reaffirmedAuditRecord] : []),
          this.prisma.content.update({
            where: { id: input.contentId },
            include: contentInclude,
            data: { status: audit.passed ? DbContentStatus.approved : DbContentStatus.rejected },
          }),
        ]);
        if (reaffirmedAuditRecord) promotedAuditRecord = results[imageAuditUpdates.length] as typeof cached;
        content = results[imageAuditUpdates.length + (reaffirmedAuditRecord ? 1 : 0)] as typeof content;
      } else if (imageAuditUpdates.length > 0 || reaffirmedAuditRecord) {
        const results = await this.prisma.$transaction([...imageAuditUpdates, ...(reaffirmedAuditRecord ? [reaffirmedAuditRecord] : [])]);
        if (reaffirmedAuditRecord) promotedAuditRecord = results[imageAuditUpdates.length] as typeof cached;
      } else {
        // The same job already owns the matching final audit record.
      }
      if (!promotedAuditRecord) throw new Error("Unable to persist the reused audit result");
      return {
        content: await this.toNormalizedContentSummary(content),
        audit,
        quality: null,
        rewrite: audit.passed ? null : this.rewriteFromAuditRecord(cached),
        auditRecord: promotedAuditRecord,
        qualityRecord: null,
      };
    }
    if (input.aiJobId) {
      const existing = await this.prisma.auditRecord.findUnique({ where: { aiJobId: input.aiJobId } });
      existingAuditRecordId = existing?.id;
    }
    const assetById = new Map(input.imageAssets.map((asset) => [asset.id, asset]));
    const assetsByHash = new Map<string, Array<{ assetId: string; fileName: string; sha256: string; buffer: Buffer; mimeType: string }>>();
    for (const imageFile of input.imageFiles) {
      const asset = assetById.get(imageFile.assetId);
      if (!asset) continue;
      const group = assetsByHash.get(imageFile.sha256) ?? [];
      group.push({ ...imageFile, fileName: asset.fileName, mimeType: asset.mimeType });
      assetsByHash.set(imageFile.sha256, group);
    }

    const textHash = createHash("sha256")
      .update(JSON.stringify({ title: input.title, body: input.body, policyVersion: CONTENT_REVIEW_POLICY_VERSION }))
      .digest("hex");
    const textReviewPromise = (async () => {
      const checkpoint = await this.prisma.contentReviewTextCheckpoint.findUnique({ where: { contentId_textHash: { contentId: input.contentId, textHash } } });
      const savedAudit = checkpoint?.audit as unknown as AuditResult | undefined;
      if (checkpoint && savedAudit && typeof savedAudit.passed === "boolean" && Array.isArray(savedAudit.riskTypes) && Array.isArray(savedAudit.reasons)) {
        return {
          audit: savedAudit,
          rewrite: checkpoint.rewrite && typeof checkpoint.rewrite === "object"
            ? checkpoint.rewrite as unknown as ComplianceRewriteResult
            : null,
        };
      }

      const result = await this.contentSafety.reviewWithRewrite({
        title: input.title,
        body: input.body,
      }, { signal: input.signal, aiJobId: input.aiJobId, contentId: input.contentId });
      await this.prisma.contentReviewTextCheckpoint.upsert({
        where: { contentId_textHash: { contentId: input.contentId, textHash } },
        create: {
          contentId: input.contentId,
          textHash,
          audit: result.audit as unknown as Prisma.InputJsonValue,
          rewrite: result.rewrite ? result.rewrite as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        },
        update: {
          audit: result.audit as unknown as Prisma.InputJsonValue,
          rewrite: result.rewrite ? result.rewrite as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        },
      });
      return result;
    })();
    const imageReviewPromise = mapWithConcurrency([...assetsByHash.entries()], 2, async ([sha256, group]) => {
      const cacheKey = { sha256, policyVersion: CONTENT_REVIEW_POLICY_VERSION };
      const cachedImage = await this.prisma.imageModerationCache.findUnique({ where: { sha256_policyVersion: cacheKey } });
      const first = group[0];
      const result = cachedImage && cachedImage.auditStatus !== AssetAuditStatus.pending
        ? {
            auditStatus: cachedImage.auditStatus,
            auditReason: cachedImage.auditReason,
            riskLevel: cachedImage.riskLevel as "low" | "medium" | "high",
            riskTypes: cachedImage.riskTypes,
          }
        : await this.imageModeration.reviewImage({
            buffer: first.buffer, mimeType: first.mimeType,
            signal: input.signal, aiJobId: input.aiJobId, contentId: input.contentId,
          });

      if (result.auditStatus === AssetAuditStatus.pending) {
        throw new AppError({ code: "IMAGE_REVIEW_UNAVAILABLE", message: result.auditReason ?? "图片审核暂不可用，请稍后重试", statusCode: 503, retryable: true });
      }

      const imageResultPersistence = [];
      if (!cachedImage || cachedImage.auditStatus === AssetAuditStatus.pending) {
        imageResultPersistence.push(this.prisma.imageModerationCache.upsert({
            where: { sha256_policyVersion: cacheKey },
            create: { ...cacheKey, auditStatus: result.auditStatus, auditReason: result.auditReason, riskLevel: result.riskLevel, riskTypes: result.riskTypes },
            update: { auditStatus: result.auditStatus, auditReason: result.auditReason, riskLevel: result.riskLevel, riskTypes: result.riskTypes },
          }));
      }
      imageResultPersistence.push(this.prisma.asset.updateMany({
          where: { id: { in: group.map((item) => item.assetId) } },
          data: { auditStatus: result.auditStatus, auditReason: result.auditReason, riskLevel: result.riskLevel, riskTypes: result.riskTypes },
        }));
      await this.prisma.$transaction(imageResultPersistence);

      return group.map((item) => ({
        assetId: item.assetId,
        fileName: item.fileName,
        sha256,
        ...result,
      }));
    });

    const [textSettled, imageSettled] = await Promise.all([
      Promise.resolve(textReviewPromise).then((value): SettledValue<Awaited<typeof textReviewPromise>> => ({ status: "fulfilled", value }), (reason): SettledValue<Awaited<typeof textReviewPromise>> => ({ status: "rejected", reason })),
      Promise.resolve(imageReviewPromise).then((value): SettledValue<Awaited<typeof imageReviewPromise>> => ({ status: "fulfilled", value }), (reason): SettledValue<Awaited<typeof imageReviewPromise>> => ({ status: "rejected", reason })),
    ]);
    if (textSettled.status === "rejected") throw textSettled.reason;
    if (imageSettled.status === "rejected") throw imageSettled.reason;

    const failedImage = imageSettled.value.find((item) => item.status === "rejected");
    if (failedImage?.status === "rejected") throw failedImage.reason;
    const { audit: textAudit, rewrite } = textSettled.value;
    const imageAudits = imageSettled.value.flatMap((item) => item.status === "fulfilled" ? item.value : []);
    const rejectedImages = imageAudits.filter((item) => item.auditStatus === AssetAuditStatus.rejected);
    const riskLevel = [textAudit.riskLevel, ...imageAudits.map((item) => item.riskLevel)]
      .sort((a, b) => ["low", "medium", "high"].indexOf(b) - ["low", "medium", "high"].indexOf(a))[0] ?? "low";
    const imageRiskTypes: AuditRiskType[] = imageAudits.flatMap((item) => item.riskTypes.map((type) => (type === "violence" ? "sensitive" : type) as AuditRiskType));
    const audit = {
      ...textAudit,
      passed: textAudit.passed && rejectedImages.length === 0,
      riskLevel: riskLevel as typeof textAudit.riskLevel,
      riskTypes: [...new Set([...textAudit.riskTypes.filter((type) => type !== "none"), ...imageRiskTypes])],
      reasons: [...textAudit.reasons, ...rejectedImages.map((item) => `图片“${item.fileName}”审核未通过：${item.auditReason ?? "存在内容风险"}`)],
      rewriteAvailable: !textAudit.passed,
    };
    const createAuditRecord = () => this.createAuditRecord(input.contentId, input.contentHash, audit, rewrite, input.aiJobId, imageAudits, existingAuditRecordId);
    const imageAssetUpdates = imageAudits.map((item) => this.prisma.asset.update({
      where: { id: item.assetId },
      data: { auditStatus: item.auditStatus, auditReason: item.auditReason, riskLevel: item.riskLevel, riskTypes: item.riskTypes },
    }));

    const contentUpdateData = !audit.passed
      ? input.updateStatus
        ? { qualityScore: 0, status: DbContentStatus.rejected }
        : null
      : input.updateStatus
        ? { status: DbContentStatus.approved }
        : null;

    if (contentUpdateData) {
      const results = await this.prisma.$transaction([
        ...imageAssetUpdates,
        createAuditRecord(),
        this.prisma.content.update({
          where: { id: input.contentId },
          data: contentUpdateData,
          include: contentInclude,
        }),
      ]);
      const auditRecord = results[imageAssetUpdates.length] as NonNullable<typeof cached>;
      const updated = results[imageAssetUpdates.length + 1] as any;

      return {
        content: await this.toNormalizedContentSummary(updated),
        audit,
        quality: null,
        rewrite: audit.passed ? null : rewrite,
        auditRecord,
        qualityRecord: null,
      };
    }

    const results = await this.prisma.$transaction([
      ...imageAssetUpdates,
      createAuditRecord(),
      this.prisma.content.findUnique({
        where: { id: input.contentId },
        include: contentInclude,
      }),
    ]);
    const auditRecord = results[imageAssetUpdates.length] as NonNullable<typeof cached>;
    const content = results[imageAssetUpdates.length + 1] as any;
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

  private currentImageAudits(
    record: { rawResponse: Prisma.JsonValue | null },
    imageFiles: Array<{ assetId: string; sha256: string }>,
    assets: Array<{ id: string; mimeType: string; auditStatus: AssetAuditStatus }>,
  ): Array<{ assetId: string; auditStatus: AssetAuditStatus; auditReason: string | null; riskLevel: string; riskTypes: string[] }> | null {
    const images = assets.filter((asset) => asset.mimeType.toLowerCase().startsWith("image/"));
    if (images.length === 0) return [];

    const raw = this.record(record.rawResponse);
    const savedAudits = Array.isArray(raw?.imageAudits)
      ? raw.imageAudits.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      : [];
    const results = images.map((asset) => {
      const saved = savedAudits.find((item) => item.assetId === asset.id);
      const current = imageFiles.find((item) => item.assetId === asset.id);
      if (!current || saved?.sha256 !== current.sha256 ||
          (saved.auditStatus !== AssetAuditStatus.approved && saved.auditStatus !== AssetAuditStatus.rejected)) return null;
      return {
        assetId: asset.id,
        auditStatus: saved.auditStatus,
        auditReason: typeof saved.auditReason === "string" ? saved.auditReason : null,
        riskLevel: typeof saved.riskLevel === "string" ? saved.riskLevel : "unknown",
        riskTypes: Array.isArray(saved.riskTypes) ? saved.riskTypes.filter((item): item is string => typeof item === "string") : [],
      };
    });
    return results.some((item) => item === null) ? null : results as NonNullable<typeof results[number]>[];
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
