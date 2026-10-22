import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { AiJobDispatchStatus, AiJobStatus, Prisma, WritingSkillSourceMode } from "@prisma/client";
import { createHash } from "node:crypto";
import { AiJobType, WritingStyleProfileSchema, type WritingStyleProfile, type WritingStyleMethod } from "@aicp/shared";
import { countArticleCharacters, ARTICLE_BODY_MAX_LENGTH } from "@aicp/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { AppError } from "../../common/app-error";
import { ModelClientService } from "./model-client.service";
import { completeStructured } from "./structured-output";

const EMPTY_METHOD: WritingStyleMethod = { structure: "", opening: "", transitions: "", ending: "", tone: "", viewpoint: "", diction: "" };
@Injectable()
export class WritingSkillService {
  constructor(private readonly prisma: PrismaService, private readonly model: ModelClientService) {}

  /** Called inside the transaction that publishes a post or changes its visibility. */
  async syncPublishedContent(tx: Prisma.TransactionClient, content: {
    id: string; authorId: string; status: string; visibility: string; publishedAt: Date | null; body: string; tags: string[];
  }, options: { enqueueRefresh?: boolean } = {}) {
    const skill = await tx.writingSkill.findUnique({ where: { userId: content.authorId } });
    if (!skill?.autoLearnFromAt || skill.pauseReason) return;
    const key = { skillId: skill.id, contentId: content.id };
    const source = await tx.writingSkillSource.findUnique({ where: { skillId_contentId: key } });
    if (source?.mode === WritingSkillSourceMode.excluded || source?.mode === WritingSkillSourceMode.manual) return;

    const eligible = content.status === "published" && content.visibility === "public" &&
      Boolean(content.publishedAt && content.publishedAt >= skill.autoLearnFromAt) &&
      countArticleCharacters(content.body) > 0 && countArticleCharacters(content.body) <= ARTICLE_BODY_MAX_LENGTH;
    if (!eligible) {
      if (source?.mode === WritingSkillSourceMode.auto) {
        const active = skill.activeVersionId ? await tx.writingSkillVersion.findUnique({ where: { id: skill.activeVersionId }, select: { sourceManifest: true } }) : null;
        const used = this.manifestContains(active?.sourceManifest, content.id);
        await tx.writingSkillSource.delete({ where: { skillId_contentId: key } });
        await tx.writingSkill.update({ where: { id: skill.id }, data: {
          sourceRevision: { increment: 1 }, candidateVersionId: null,
          ...(used ? { pauseReason: "已纳入风格的文章不再符合自动学习条件，档案已暂停" } : {}),
        } });
      }
      return;
    }

    const hash = this.hash(content.body);
    if (source?.mode === WritingSkillSourceMode.auto && source.contentHash === hash) return;
    const active = skill.activeVersionId ? await tx.writingSkillVersion.findUnique({ where: { id: skill.activeVersionId }, select: { sourceManifest: true } }) : null;
    const used = this.manifestContains(active?.sourceManifest, content.id);
    await tx.writingSkillSource.upsert({
      where: { skillId_contentId: key },
      create: { ...key, mode: WritingSkillSourceMode.auto, contentHash: hash },
      update: { mode: WritingSkillSourceMode.auto, contentHash: hash, extractedProfile: Prisma.JsonNull, extractedAt: null },
    });
    const updated = await tx.writingSkill.update({ where: { id: skill.id }, data: {
      sourceRevision: { increment: 1 }, candidateVersionId: null,
      ...(used ? { pauseReason: "已纳入风格的文章正文已变化，档案已暂停" } : {}),
    } });
    if (!used && options.enqueueRefresh !== false) await this.enqueueRefresh(tx, skill.id, content.authorId, updated.sourceRevision);
  }

  async enqueuePendingRefreshes() {
    let afterSkillId = "";
    while (true) {
      const skills = await this.prisma.writingSkill.findMany({
        where: { id: { gt: afterSkillId }, activeVersionId: { not: null }, autoLearnFromAt: { not: null }, pauseReason: null, sourceRevision: { gt: 0 } },
        select: { id: true, userId: true, sourceRevision: true, appliedRevision: true }, orderBy: { id: "asc" }, take: 100,
      });
      if (!skills.length) break;
      for (const skill of skills) if (skill.sourceRevision > skill.appliedRevision) {
        await this.prisma.$transaction((tx) => this.enqueueRefresh(tx, skill.id, skill.userId, skill.sourceRevision));
      }
      afterSkillId = skills[skills.length - 1].id;
      if (skills.length < 100) break;
    }
  }

  /** Repair missed transactional hooks without importing articles published before confirmation. */
  async reconcileAutoLearning() {
    let reconciled = 0;
    let afterSkillId = "";
    while (true) {
      const skills = await this.prisma.writingSkill.findMany({
        where: { id: { gt: afterSkillId }, activeVersionId: { not: null }, autoLearnFromAt: { not: null } },
        select: { id: true, userId: true, autoLearnFromAt: true }, orderBy: { id: "asc" }, take: 100,
      });
      if (!skills.length) break;
      for (const skill of skills) {
        let afterSourceId = "";
        while (true) {
          const knownSources = await this.prisma.writingSkillSource.findMany({
            where: { skillId: skill.id, mode: WritingSkillSourceMode.auto, contentId: { gt: afterSourceId } },
            include: { content: true }, orderBy: { contentId: "asc" }, take: 200,
          });
          if (!knownSources.length) break;
          for (const source of knownSources) {
            await this.prisma.$transaction((tx) => this.syncPublishedContent(tx, source.content, { enqueueRefresh: false }));
            reconciled += 1;
          }
          afterSourceId = knownSources[knownSources.length - 1].contentId;
          if (knownSources.length < 200) break;
        }
        let afterContentId = "";
        while (true) {
          const missing = await this.prisma.content.findMany({
            where: {
              id: { gt: afterContentId }, authorId: skill.userId, status: "published", visibility: "public",
              publishedAt: { gte: skill.autoLearnFromAt! },
              writingSkillSources: { none: { skillId: skill.id } },
            },
            orderBy: { id: "asc" }, take: 200,
          });
          if (!missing.length) break;
          for (const content of missing) {
            if (countArticleCharacters(content.body) > 0 && countArticleCharacters(content.body) <= ARTICLE_BODY_MAX_LENGTH) {
              await this.prisma.$transaction((tx) => this.syncPublishedContent(tx, content, { enqueueRefresh: false }));
              reconciled += 1;
            }
          }
          afterContentId = missing[missing.length - 1].id;
          if (missing.length < 200) break;
        }
      }
      afterSkillId = skills[skills.length - 1].id;
      if (skills.length < 100) break;
    }
    return reconciled;
  }

  async refreshAuto(userId: string, skillId: string, expectedSourceRevision: number) {
    const skill = await this.prisma.writingSkill.findFirst({ where: { id: skillId, userId }, include: { activeVersion: true } });
    if (!skill?.activeVersion || skill.pauseReason || skill.sourceRevision !== expectedSourceRevision) return { refreshed: false, reason: "stale_or_paused" as const };
    const sources = await this.prisma.writingSkillSource.findMany({
      where: { skillId, mode: { in: [WritingSkillSourceMode.manual, WritingSkillSourceMode.auto] } },
      include: { content: { select: { id: true, authorId: true, title: true, body: true, tags: true, status: true, visibility: true, publishedAt: true } } },
    });
    const eligible = sources.filter(({ mode, content }) => content.authorId === userId && content.status === "published" &&
      countArticleCharacters(content.body) > 0 && countArticleCharacters(content.body) <= ARTICLE_BODY_MAX_LENGTH &&
      (mode === WritingSkillSourceMode.manual || (content.visibility === "public" && Boolean(content.publishedAt && skill.autoLearnFromAt && content.publishedAt >= skill.autoLearnFromAt))));
    if (!eligible.length) return { refreshed: false, reason: "no_sources" as const };
    const baseProfile = WritingStyleProfileSchema.parse(skill.activeVersion.profile);
    const start = { sourceRevision: skill.sourceRevision, editRevision: skill.editRevision, activeVersionId: skill.activeVersionId };
    try {
      const methods = await Promise.all(eligible.map(async ({ content, contentHash, extractedProfile }) => {
        const hash = this.hash(content.body);
        if (contentHash === hash && extractedProfile) {
          const parsed = WritingStyleProfileSchema.shape.common.safeParse(extractedProfile);
          if (parsed.success) return { content, hash, method: parsed.data };
        }
        return { content, hash, method: await this.extractMethod(content.title, content.tags, content.body) };
      }));
      return await this.prisma.$transaction(async (tx) => {
        const latestSkill = await tx.writingSkill.findFirst({ where: { id: skillId, userId }, include: { activeVersion: true } });
        if (!latestSkill || latestSkill.sourceRevision !== start.sourceRevision || latestSkill.editRevision !== start.editRevision || latestSkill.activeVersionId !== start.activeVersionId || latestSkill.pauseReason) {
          return { refreshed: false, reason: "stale_during_refresh" as const };
        }
        const latestRows = await tx.writingSkillSource.findMany({
          where: { skillId, contentId: { in: methods.map(({ content }) => content.id) }, mode: { in: [WritingSkillSourceMode.manual, WritingSkillSourceMode.auto] } },
          include: { content: { select: { id: true, body: true, authorId: true, status: true, visibility: true, publishedAt: true } } },
        });
        const current = new Map(latestRows.map((row) => [row.contentId, row]));
        if (methods.some(({ content, hash }) => {
          const row = current.get(content.id);
          if (!row || row.content.authorId !== userId || row.content.status !== "published" || this.hash(row.content.body) !== hash) return true;
          return row.mode === WritingSkillSourceMode.auto && (row.content.visibility !== "public" || !row.content.publishedAt || !latestSkill.autoLearnFromAt || row.content.publishedAt < latestSkill.autoLearnFromAt);
        })) throw new ConflictException("自动学习来源在刷新期间发生变化");

        for (const { content, hash, method } of methods) await tx.writingSkillSource.update({
          where: { skillId_contentId: { skillId, contentId: content.id } },
          data: { contentHash: hash, extractedProfile: method as Prisma.InputJsonValue, extractedAt: new Date() },
        });
        const profile = this.profileFromMethods(methods.map(({ content, method }) => ({ tags: content.tags, method })), baseProfile);
        const manifest = methods.map(({ content, hash }) => ({ contentId: content.id, contentHash: hash }));
        const versionNo = (await tx.writingSkillVersion.aggregate({ where: { skillId }, _max: { versionNo: true } }))._max.versionNo ?? 0;
        const version = await tx.writingSkillVersion.create({ data: {
          skillId, versionNo: versionNo + 1, profile: profile as unknown as Prisma.InputJsonValue,
          sourceManifest: manifest as unknown as Prisma.InputJsonValue, sourceRevision: start.sourceRevision,
          editRevision: start.editRevision, origin: "auto_refresh", parentVersionId: start.activeVersionId,
        } });
        const activated = await tx.writingSkill.updateMany({ where: {
          id: skillId, sourceRevision: start.sourceRevision, editRevision: start.editRevision,
          activeVersionId: start.activeVersionId, pauseReason: null,
        }, data: { activeVersionId: version.id, appliedRevision: start.sourceRevision, candidateVersionId: null, lastError: null } });
        if (activated.count !== 1) return { refreshed: false, reason: "activation_conflict" as const };
        return { refreshed: true, activeVersionId: version.id, sourceRevision: start.sourceRevision };
      });
    } catch (error) {
      await this.prisma.writingSkill.updateMany({ where: { id: skillId, userId, sourceRevision: expectedSourceRevision }, data: { lastError: "自动更新写作风格失败，可稍后重试" } }).catch(() => undefined);
      throw error;
    }
  }

  private async enqueueRefresh(tx: Prisma.TransactionClient, skillId: string, userId: string, sourceRevision: number) {
    const idempotencyKey = `writing-skill-refresh:${skillId}:${sourceRevision}`;
    const existing = await tx.aiJob.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, select: { id: true, status: true } });
    if (existing) {
      if (existing.status === AiJobStatus.queued || existing.status === AiJobStatus.running || existing.status === AiJobStatus.succeeded) return existing.id;
      const latestRetry = await tx.aiJob.findFirst({
        where: { userId, type: AiJobType.WritingSkillRefresh, idempotencyKey: { startsWith: `${idempotencyKey}:retry:` } },
        orderBy: { createdAt: "desc" }, select: { id: true, status: true, idempotencyKey: true },
      });
      if (latestRetry && (latestRetry.status === AiJobStatus.queued || latestRetry.status === AiJobStatus.running || latestRetry.status === AiJobStatus.succeeded)) return latestRetry.id;
      // Stable retry numbers ensure repeated maintenance passes do not enqueue duplicates.
      const previousAttempt = Number(latestRetry?.idempotencyKey?.split(":retry:").at(-1) ?? 0);
      const retryKey = `${idempotencyKey}:retry:${Number.isSafeInteger(previousAttempt) ? previousAttempt + 1 : 1}`;
      const retry = await tx.aiJob.create({ data: {
        userId, type: AiJobType.WritingSkillRefresh, status: AiJobStatus.queued, idempotencyKey: retryKey,
        input: { skillId, sourceRevision } as Prisma.InputJsonValue,
        dispatch: { create: { status: AiJobDispatchStatus.pending } },
      } });
      return retry.id;
    }
    const job = await tx.aiJob.create({ data: {
      userId, type: AiJobType.WritingSkillRefresh, status: AiJobStatus.queued, idempotencyKey,
      input: { skillId, sourceRevision } as Prisma.InputJsonValue,
      dispatch: { create: { status: AiJobDispatchStatus.pending } },
    } });
    return job.id;
  }

  async eligible(userId: string, page = 1, pageSize = 20) {
    const safePage = Math.max(1, Math.floor(page));
    const take = Math.min(50, Math.max(1, Math.floor(pageSize)));
    const where = { authorId: userId, status: "published" as const };
    const [items, total] = await Promise.all([
      this.prisma.content.findMany({ where, orderBy: { publishedAt: "desc" }, skip: (safePage - 1) * take, take,
        select: { id: true, title: true, body: true, bodyHtml: true, bodyJson: true, visibility: true, publishedAt: true } }),
      this.prisma.content.count({ where }),
    ]);
    return { page: safePage, pageSize: take, total, items: items.map(({ body, ...item }) => ({
      id: item.id, title: item.title, visibility: item.visibility, publishedAt: item.publishedAt,
      characterCount: countArticleCharacters(body), eligible: countArticleCharacters(body) > 0 && countArticleCharacters(body) <= ARTICLE_BODY_MAX_LENGTH,
      reason: countArticleCharacters(body) > ARTICLE_BODY_MAX_LENGTH ? `正文超过 ${ARTICLE_BODY_MAX_LENGTH} 字` : countArticleCharacters(body) === 0 ? "正文为空" : null,
    })) };
  }

  async get(userId: string) {
    const skill = await this.prisma.writingSkill.findUnique({ where: { userId }, include: {
      activeVersion: true, candidateVersion: true, versions: { orderBy: { versionNo: "desc" }, take: 30 },
      sources: { include: { content: { select: { id: true, title: true, status: true, visibility: true } } } },
    } });
    return skill ?? { status: "uncreated", activeVersion: null, candidateVersion: null, versions: [], sources: [] };
  }

  async buildCandidate(userId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length < 3 || unique.length > 20 || unique.length !== ids.length) throw new UnprocessableEntityException("请选择 3 到 20 篇不同的文章");
    const articles = await this.prisma.content.findMany({ where: { id: { in: unique }, authorId: userId, status: "published" },
      select: { id: true, title: true, body: true, updatedAt: true, tags: true } });
    if (articles.length !== unique.length || articles.some((item) => countArticleCharacters(item.body) === 0 || countArticleCharacters(item.body) > ARTICLE_BODY_MAX_LENGTH)) {
      throw new UnprocessableEntityException("所选文章必须是本人已发布且正文不超过 1000 字的文章");
    }
    const before = new Map(articles.map((item) => [item.id, this.hash(item.body)]));
    const skillAtStart = await this.prisma.writingSkill.upsert({ where: { userId }, create: { userId }, update: {} });
    const buildRevision = skillAtStart.sourceRevision + 1;
    const started = await this.prisma.writingSkill.updateMany({ where: { id: skillAtStart.id, sourceRevision: skillAtStart.sourceRevision }, data: {
      sourceRevision: buildRevision, candidateVersionId: null, lastError: null,
    } });
    if (started.count !== 1) throw new ConflictException("写作风格档案已变化，请重新生成");
    let extracts: Array<{ item: typeof articles[number]; method: WritingStyleMethod; hash: string }>;
    try {
      extracts = await Promise.all(articles.map(async (item) => {
      const method = await completeStructured({ modelClient: this.model, name: "writing_style_method", schema: WritingStyleProfileSchema.shape.common,
        messages: [
          { role: "system", content: "你是写作风格分析器。只提炼结构、语气、视角、开头、过渡、结尾和措辞规律。严禁复述或保留具体人物、事件、地点、时间、价格、数字、专有名词和原文句子。输出严格 JSON 对象，字段为 structure, opening, transitions, ending, tone, viewpoint, diction，值均为简短写法规律。" },
          { role: "user", content: `标题：${item.title}\n标签：${item.tags.join("、")}\n正文：\n${item.body}` },
        ],
      });
        return { item, method, hash: before.get(item.id)! };
      }));
    } catch (error) {
      await this.prisma.writingSkill.updateMany({ where: { id: skillAtStart.id, sourceRevision: buildRevision }, data: { lastError: "写法提炼失败，可重试" } });
      if (error instanceof AppError && error.code === "UPSTREAM_INVALID_RESPONSE") {
        throw new AppError({ code: error.code, message: error.message, statusCode: 502, retryable: true, cause: error });
      }
      throw error;
    }
    // Reject a source edited or unpublished while the model was working.
    const latest = await this.prisma.content.findMany({ where: { id: { in: unique }, authorId: userId, status: "published" }, select: { id: true, body: true } });
    if (latest.length !== unique.length || latest.some((item) => this.hash(item.body) !== before.get(item.id))) throw new ConflictException("来源文章已变化，请重新选择并生成");
    const method = this.mergeMethods(extracts.map((item) => item.method));
    const grouped = new Map<string, typeof extracts>();
    for (const extracted of extracts) {
      const topic = extracted.item.tags.find((tag) => tag.trim())?.trim();
      if (topic) grouped.set(topic, [...(grouped.get(topic) ?? []), extracted]);
    }
    const topics = [...grouped.entries()].filter(([, values]) => values.length >= 2).map(([label, values]) => ({
      key: label.toLowerCase().replace(/\s+/g, "-"), label, sampleCount: values.length, method: this.mergeMethods(values.map((item) => item.method)),
    }));
    const profile = WritingStyleProfileSchema.parse({ schemaVersion: 1, summary: `基于 ${articles.length} 篇已发布文章提炼的个人写作方式`, common: method, topics, authorLockedPaths: [] });
    return this.prisma.$transaction(async (tx) => {
      const skill = await tx.writingSkill.findUnique({ where: { id: skillAtStart.id } });
      if (!skill || skill.sourceRevision !== buildRevision) throw new ConflictException("写作风格或来源已变化，请重新生成候选");
      const sourceRevision = buildRevision;
      for (const { item, method: extracted, hash } of extracts) await tx.writingSkillSource.upsert({
        where: { skillId_contentId: { skillId: skill.id, contentId: item.id } },
        create: { skillId: skill.id, contentId: item.id, mode: WritingSkillSourceMode.manual, contentHash: hash, extractedProfile: extracted as Prisma.InputJsonValue, extractedAt: new Date() },
        update: { mode: WritingSkillSourceMode.manual, contentHash: hash, extractedProfile: extracted as Prisma.InputJsonValue, extractedAt: new Date() },
      });
      const versionNo = (await tx.writingSkillVersion.aggregate({ where: { skillId: skill.id }, _max: { versionNo: true } }))._max.versionNo ?? 0;
      const candidate = await tx.writingSkillVersion.create({ data: {
        skillId: skill.id, versionNo: versionNo + 1, profile: profile as unknown as Prisma.InputJsonValue,
        sourceManifest: extracts.map(({ item, hash }) => ({ contentId: item.id, contentHash: hash })) as unknown as Prisma.InputJsonValue,
        sourceRevision, editRevision: skill.editRevision, origin: "ai_candidate",
      } });
      await tx.writingSkill.update({ where: { id: skill.id }, data: { candidateVersionId: candidate.id, lastError: null } });
      return { candidateVersion: candidate, status: "awaiting_confirmation" as const };
    });
  }

  async confirm(userId: string, versionId: string, editedProfile: unknown, expectedSourceRevision: number, expectedEditRevision: number) {
    const profile = WritingStyleProfileSchema.parse(editedProfile);
    return this.prisma.$transaction(async (tx) => {
      const skill = await tx.writingSkill.findUnique({ where: { userId }, include: { candidateVersion: true } });
      if (!skill || !skill.candidateVersion || skill.candidateVersion.id !== versionId) throw new NotFoundException("候选版本不存在");
      if (skill.sourceRevision !== expectedSourceRevision || skill.editRevision !== expectedEditRevision || skill.candidateVersion.sourceRevision !== skill.sourceRevision) throw new ConflictException("写作风格或来源已变化，请重新生成候选");
      await this.assertManifestCurrent(tx, userId, skill.id, skill.candidateVersion.sourceManifest);
      const locks = [...new Set([...profile.authorLockedPaths, ...this.changedPaths(skill.candidateVersion.profile, profile)])];
      const finalProfile = WritingStyleProfileSchema.parse({ ...profile, authorLockedPaths: locks });
      const versionNo = (await tx.writingSkillVersion.aggregate({ where: { skillId: skill.id }, _max: { versionNo: true } }))._max.versionNo ?? 0;
      const active = await tx.writingSkillVersion.create({ data: { skillId: skill.id, versionNo: versionNo + 1,
        profile: finalProfile as unknown as Prisma.InputJsonValue, sourceManifest: skill.candidateVersion.sourceManifest as unknown as Prisma.InputJsonValue,
        sourceRevision: skill.sourceRevision, editRevision: skill.editRevision, origin: "author_confirmed", parentVersionId: skill.candidateVersion.id } });
      await tx.writingSkill.update({ where: { id: skill.id }, data: {
        activeVersionId: active.id, candidateVersionId: null, appliedRevision: skill.sourceRevision,
        autoLearnFromAt: skill.autoLearnFromAt ?? new Date(), pauseReason: null, lastError: null,
      } });
      return { activeVersionId: active.id, activeVersion: active };
    });
  }

  async setSourceMode(userId: string, contentId: string, mode: "manual" | "excluded") {
    const skill = await this.prisma.writingSkill.findUnique({ where: { userId } });
    if (!skill) throw new NotFoundException("写作风格档案不存在");
    const content = await this.prisma.content.findFirst({ where: { id: contentId, authorId: userId, status: "published" }, select: { id: true, body: true } });
    if (!content) throw new NotFoundException("来源文章不存在");
    const source = await this.prisma.writingSkillSource.findUnique({ where: { skillId_contentId: { skillId: skill.id, contentId } } });
    if (!source) throw new NotFoundException("来源文章尚未加入档案，请重新生成候选");
    await this.prisma.$transaction(async (tx) => {
      await tx.writingSkillSource.update({ where: { skillId_contentId: { skillId: skill.id, contentId } }, data: { mode } });
      const next = skill.sourceRevision + 1;
      const activeContains = this.manifestContains((await tx.writingSkillVersion.findUnique({ where: { id: skill.activeVersionId ?? "" }, select: { sourceManifest: true } }))?.sourceManifest, contentId);
      await tx.writingSkill.update({ where: { id: skill.id }, data: { sourceRevision: next, candidateVersionId: null,
        ...(activeContains ? { pauseReason: "来源文章集合已变化，请重新生成并确认" } : {}) } });
    });
    return this.get(userId);
  }

  async updateProfile(userId: string, updatedProfile: unknown) {
    const submitted = WritingStyleProfileSchema.parse(updatedProfile);
    return this.prisma.$transaction(async (tx) => {
      const skill = await tx.writingSkill.findUnique({ where: { userId }, include: { activeVersion: true } });
      if (!skill?.activeVersion) throw new NotFoundException("当前没有已确认的写作风格版本");
      if (skill.pauseReason) throw new ConflictException("档案已暂停，请先重新生成候选并确认");
      await this.assertManifestCurrent(tx, userId, skill.id, skill.activeVersion.sourceManifest);
      const previous = WritingStyleProfileSchema.parse(skill.activeVersion.profile);
      const locks = [...new Set([...submitted.authorLockedPaths, ...this.changedPaths(previous, submitted)])];
      const profile = WritingStyleProfileSchema.parse({ ...submitted, authorLockedPaths: locks });
      const versionNo = (await tx.writingSkillVersion.aggregate({ where: { skillId: skill.id }, _max: { versionNo: true } }))._max.versionNo ?? 0;
      const next = await tx.writingSkillVersion.create({ data: { skillId: skill.id, versionNo: versionNo + 1,
        profile: profile as unknown as Prisma.InputJsonValue, sourceManifest: skill.activeVersion.sourceManifest as unknown as Prisma.InputJsonValue,
        sourceRevision: skill.sourceRevision, editRevision: skill.editRevision + 1, origin: "author_edit", parentVersionId: skill.activeVersion.id } });
      await tx.writingSkill.update({ where: { id: skill.id }, data: { activeVersionId: next.id, editRevision: { increment: 1 }, candidateVersionId: null } });
      return { activeVersionId: next.id, activeVersion: next };
    });
  }

  async unlockProfilePaths(userId: string, paths: string[]) {
    const current = await this.prisma.writingSkill.findUnique({ where: { userId }, include: { activeVersion: true } });
    if (!current?.activeVersion) throw new NotFoundException("当前没有已确认的写作风格版本");
    const profile = WritingStyleProfileSchema.parse(current.activeVersion.profile);
    const remove = new Set(paths);
    return this.updateProfile(userId, { ...profile, authorLockedPaths: profile.authorLockedPaths.filter((path) => !remove.has(path)) });
  }

  async restore(userId: string, versionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const skill = await tx.writingSkill.findUnique({ where: { userId } });
      const source = await tx.writingSkillVersion.findFirst({ where: { id: versionId, skillId: skill?.id } });
      if (!skill || !source) throw new NotFoundException("版本不存在");
      await this.assertManifestCurrent(tx, userId, skill.id, source.sourceManifest);
      const versionNo = (await tx.writingSkillVersion.aggregate({ where: { skillId: skill.id }, _max: { versionNo: true } }))._max.versionNo ?? 0;
      const restored = await tx.writingSkillVersion.create({ data: { skillId: skill.id, versionNo: versionNo + 1, profile: source.profile as unknown as Prisma.InputJsonValue,
        sourceManifest: source.sourceManifest as unknown as Prisma.InputJsonValue, sourceRevision: skill.sourceRevision, editRevision: skill.editRevision,
        origin: "restore", parentVersionId: source.id } });
      await tx.writingSkill.update({ where: { id: skill.id }, data: { activeVersionId: restored.id, candidateVersionId: null, appliedRevision: skill.sourceRevision, pauseReason: null } });
      return { activeVersionId: restored.id, activeVersion: restored };
    });
  }

  async invalidateContent(tx: Prisma.TransactionClient, contentId: string) {
    const links = await tx.writingSkillSource.findMany({ where: { contentId }, select: { skillId: true, mode: true } });
    for (const { skillId, mode } of links) {
      // Keep explicit author decisions. An excluded row is a tombstone that
      // prevents a later publish/edit reconciliation from auto-enrolling it;
      // a manual row must not silently turn into an automatic source.
      if (mode === WritingSkillSourceMode.excluded) continue;
      const skill = await tx.writingSkill.findUnique({ where: { id: skillId } });
      if (!skill) continue;
      const activeManifest = skill.activeVersionId ? (await tx.writingSkillVersion.findUnique({ where: { id: skill.activeVersionId }, select: { sourceManifest: true } }))?.sourceManifest : null;
      const candidateManifest = skill.candidateVersionId ? (await tx.writingSkillVersion.findUnique({ where: { id: skill.candidateVersionId }, select: { sourceManifest: true } }))?.sourceManifest : null;
      const used = this.manifestContains(activeManifest, contentId);
      if (mode === WritingSkillSourceMode.auto) {
        await tx.writingSkillSource.deleteMany({ where: { skillId, contentId, mode: WritingSkillSourceMode.auto } });
      }
      await tx.writingSkill.update({ where: { id: skillId }, data: { sourceRevision: { increment: 1 }, candidateVersionId: null,
        ...(used ? { pauseReason: "当前版本来源文章已修改或下线，已暂停使用" } : {}),
        ...(this.manifestContains(candidateManifest, contentId) ? { lastError: "候选来源已变化，请重新生成" } : {}) } });
    }
  }

  private async assertManifestCurrent(tx: Prisma.TransactionClient, userId: string, skillId: string, manifest: Prisma.JsonValue) {
    const values = Array.isArray(manifest) ? manifest as Array<{ contentId?: string; contentHash?: string }> : [];
    if (!values.length) throw new ConflictException("版本来源无效");
    const current = await tx.content.findMany({ where: { id: { in: values.map((item) => item.contentId ?? "") }, authorId: userId, status: "published" }, select: { id: true, body: true, visibility: true } });
    const map = new Map(current.map((item) => [item.id, this.hash(item.body)]));
    const sourceRows = await tx.writingSkillSource.findMany({ where: { skillId, contentId: { in: values.map((item) => item.contentId ?? "") }, mode: { not: WritingSkillSourceMode.excluded } }, select: { contentId: true, mode: true } });
    const sourceMode = new Map(sourceRows.map((source) => [source.contentId, source.mode]));
    const visibility = new Map(current.map((item) => [item.id, item.visibility]));
    if (values.some((item) => !item.contentId || !sourceMode.has(item.contentId) || map.get(item.contentId) !== item.contentHash || (sourceMode.get(item.contentId) === WritingSkillSourceMode.auto && visibility.get(item.contentId) !== "public"))) throw new ConflictException("来源文章已变化，请重新生成候选");
  }
  private async extractMethod(title: string, tags: string[], body: string): Promise<WritingStyleMethod> {
    return completeStructured({ modelClient: this.model, name: "writing_style_method", schema: WritingStyleProfileSchema.shape.common,
      messages: [
        { role: "system", content: "你是写作风格分析器。只提炼结构、语气、视角、开头、过渡、结尾和措辞规律。严禁复述或保留具体人物、事件、地点、时间、价格、数字、专有名词和原文句子。输出严格 JSON 对象，字段为 structure, opening, transitions, ending, tone, viewpoint, diction，值均为简短写法规律。" },
        { role: "user", content: `标题：${title}\n标签：${tags.join("、")}\n正文：\n${body}` },
      ],
    });
  }
  private profileFromMethods(entries: Array<{ tags: string[]; method: WritingStyleMethod }>, previous: WritingStyleProfile): WritingStyleProfile {
    const grouped = new Map<string, { label: string; methods: WritingStyleMethod[] }>();
    for (const entry of entries) {
      const label = entry.tags.find((tag) => tag.trim())?.trim();
      if (!label) continue;
      const key = label.toLowerCase().replace(/\s+/g, "-");
      const group = grouped.get(key) ?? { label, methods: [] };
      group.methods.push(entry.method);
      grouped.set(key, group);
    }
    const generated = WritingStyleProfileSchema.parse({
      schemaVersion: 1,
      summary: `基于 ${entries.length} 篇文章提炼的个人写作方式`,
      common: this.mergeMethods(entries.map((entry) => entry.method)),
      topics: [...grouped.entries()].filter(([, value]) => value.methods.length >= 2).map(([key, value]) => ({
        key, label: value.label, sampleCount: value.methods.length, method: this.mergeMethods(value.methods),
      })),
      authorLockedPaths: previous.authorLockedPaths,
    });
    const result = structuredClone(generated) as WritingStyleProfile;
    const priorTopics = new Map(previous.topics.map((topic) => [topic.key, topic]));
    for (const path of previous.authorLockedPaths) {
      const [root, topicKey, field] = path.split(".");
      if (path === "summary") result.summary = previous.summary;
      else if (root === "common" && field === undefined && topicKey in result.common) result.common[topicKey as keyof WritingStyleMethod] = previous.common[topicKey as keyof WritingStyleMethod];
      else if (root === "topics" && topicKey && field === undefined) {
        const prior = priorTopics.get(topicKey);
        if (prior) {
          const index = result.topics.findIndex((topic) => topic.key === topicKey);
          if (index >= 0) result.topics[index] = prior;
          else result.topics.push(prior);
        }
      } else if (root === "topics" && topicKey && field && field in EMPTY_METHOD) {
        const prior = priorTopics.get(topicKey);
        const target = result.topics.find((topic) => topic.key === topicKey);
        if (prior && target) target.method[field as keyof WritingStyleMethod] = prior.method[field as keyof WritingStyleMethod];
        else if (prior && !target) result.topics.push(prior);
      }
    }
    return WritingStyleProfileSchema.parse(result);
  }
  private mergeMethods(methods: WritingStyleMethod[]): WritingStyleMethod {
    const result = { ...EMPTY_METHOD };
    for (const key of Object.keys(result) as (keyof WritingStyleMethod)[]) result[key] = [...new Set(methods.map((item) => item[key].trim()).filter(Boolean))].slice(0, 4).join("；").slice(0, 1200);
    return result;
  }
  private changedPaths(oldValue: unknown, newValue: WritingStyleProfile) {
    const previous = oldValue as WritingStyleProfile;
    const paths: string[] = [];
    const fields = Object.keys(EMPTY_METHOD) as (keyof WritingStyleMethod)[];
    if (previous.summary !== newValue.summary) paths.push("summary");
    for (const field of fields) if (previous.common[field] !== newValue.common[field]) paths.push(`common.${field}`);
    const oldTopics = new Map(previous.topics.map((topic) => [topic.key, topic]));
    for (const topic of newValue.topics) {
      const oldTopic = oldTopics.get(topic.key);
      if (!oldTopic) { paths.push(`topics.${topic.key}`); continue; }
      for (const field of fields) if (oldTopic.method[field] !== topic.method[field]) paths.push(`topics.${topic.key}.${field}`);
    }
    for (const topic of previous.topics) if (!newValue.topics.some((item) => item.key === topic.key)) paths.push(`topics.${topic.key}`);
    return paths;
  }
  private manifestContains(manifest: Prisma.JsonValue | null | undefined, id: string) { return Array.isArray(manifest) && manifest.some((row) => row && typeof row === "object" && "contentId" in row && row.contentId === id); }
  private hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
}
