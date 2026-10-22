import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { WritingSkillService } from "./writing-skill.service";

describe("WritingSkillService", () => {
  it("adds a future public short post as an automatic source and queues refresh in the same transaction", async () => {
    const skill = { id: "skill", sourceRevision: 4, activeVersionId: "active", autoLearnFromAt: new Date("2026-01-01T00:00:00Z") };
    const tx = {
      writingSkill: { findUnique: vi.fn().mockResolvedValue(skill), update: vi.fn().mockResolvedValue({ ...skill, sourceRevision: 5 }) },
      writingSkillSource: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
      writingSkillVersion: { findUnique: vi.fn().mockResolvedValue({ sourceManifest: [] }) },
      aiJob: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "refresh-job" }) },
    };
    const service = new WritingSkillService({} as never, {} as never);
    await service.syncPublishedContent(tx as never, {
      id: "post", authorId: "owner", status: "published", visibility: "public", publishedAt: new Date("2026-02-01T00:00:00Z"), body: "体验了三天后的真实感受", tags: ["旅行"],
    });
    expect(tx.writingSkillSource.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ contentId: "post", mode: "auto" }),
    }));
    expect(tx.writingSkill.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sourceRevision: { increment: 1 } }) }));
    expect(tx.aiJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      type: "writing_skill_refresh", input: { skillId: "skill", sourceRevision: 5 },
      dispatch: { create: { status: "pending" } },
    }) }));
  });

  it("never re-adds an excluded post to automatic learning", async () => {
    const tx = {
      writingSkill: { findUnique: vi.fn().mockResolvedValue({ id: "skill", sourceRevision: 1, activeVersionId: "active", autoLearnFromAt: new Date("2026-01-01") }) },
      writingSkillSource: { findUnique: vi.fn().mockResolvedValue({ mode: "excluded" }), upsert: vi.fn() },
      writingSkillVersion: { findUnique: vi.fn() }, aiJob: { create: vi.fn() },
    };
    const service = new WritingSkillService({} as never, {} as never);
    await service.syncPublishedContent(tx as never, {
      id: "post", authorId: "owner", status: "published", visibility: "public", publishedAt: new Date("2026-02-01"), body: "短文", tags: [],
    });
    expect(tx.writingSkillSource.upsert).not.toHaveBeenCalled();
    expect(tx.aiJob.create).not.toHaveBeenCalled();
  });

  it("preserves excluded and manual source decisions when a post changes", async () => {
    const rows = [
      { skillId: "excluded-skill", mode: "excluded" },
      { skillId: "manual-skill", mode: "manual" },
      { skillId: "auto-skill", mode: "auto" },
    ];
    const deleteMany = vi.fn();
    const update = vi.fn();
    const tx = {
      writingSkillSource: { findMany: vi.fn().mockResolvedValue(rows), deleteMany },
      writingSkill: { findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => ({ id: where.id, activeVersionId: `${where.id}-active`, candidateVersionId: null })), update },
      writingSkillVersion: { findUnique: vi.fn().mockResolvedValue({ sourceManifest: [{ contentId: "post", contentHash: "old" }] }) },
    };
    const service = new WritingSkillService({} as never, {} as never);

    await service.invalidateContent(tx as never, "post");

    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { skillId: "auto-skill", contentId: "post", mode: "auto" } });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "manual-skill" }, data: expect.objectContaining({ pauseReason: expect.any(String) }) }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "auto-skill" }, data: expect.objectContaining({ pauseReason: expect.any(String) }) }));
  });

  it("does not auto-enroll new posts while a profile is paused for source review", async () => {
    const tx = {
      writingSkill: { findUnique: vi.fn().mockResolvedValue({ id: "skill", sourceRevision: 2, activeVersionId: "active", autoLearnFromAt: new Date("2026-01-01"), pauseReason: "source changed" }) },
      writingSkillSource: { findUnique: vi.fn(), upsert: vi.fn() },
      writingSkillVersion: { findUnique: vi.fn() },
      aiJob: { create: vi.fn() },
    };
    const service = new WritingSkillService({} as never, {} as never);

    await service.syncPublishedContent(tx as never, {
      id: "new-post", authorId: "owner", status: "published", visibility: "public", publishedAt: new Date("2026-02-01"), body: "鐭枃", tags: [],
    });

    expect(tx.writingSkillSource.findUnique).not.toHaveBeenCalled();
    expect(tx.writingSkillSource.upsert).not.toHaveBeenCalled();
    expect(tx.aiJob.create).not.toHaveBeenCalled();
  });

  it("reuses an in-flight retry instead of creating a job on every maintenance pass", async () => {
    const tx = {
      writingSkill: { findUnique: vi.fn().mockResolvedValue({ id: "skill", sourceRevision: 4, activeVersionId: "active", autoLearnFromAt: new Date("2026-01-01") }), update: vi.fn().mockResolvedValue({ sourceRevision: 5 }) },
      writingSkillSource: { findUnique: vi.fn().mockResolvedValue({ mode: "auto", contentHash: "old-hash" }), upsert: vi.fn() },
      writingSkillVersion: { findUnique: vi.fn().mockResolvedValue({ sourceManifest: [] }) },
      aiJob: {
        findUnique: vi.fn().mockResolvedValue({ id: "failed-original", status: "failed" }),
        findFirst: vi.fn().mockResolvedValue({ id: "retry-in-flight", status: "queued", idempotencyKey: "writing-skill-refresh:skill:5:retry:1" }),
        create: vi.fn(),
      },
    };
    const service = new WritingSkillService({} as never, {} as never);
    await service.syncPublishedContent(tx as never, {
      id: "post", authorId: "owner", status: "published", visibility: "public", publishedAt: new Date("2026-02-01"), body: "正文有变化", tags: [],
    });
    expect(tx.aiJob.findFirst).toHaveBeenCalled();
    expect(tx.aiJob.create).not.toHaveBeenCalled();
  });

  it("pauses the active profile when one of its automatic sources becomes private", async () => {
    const tx = {
      writingSkill: { findUnique: vi.fn().mockResolvedValue({ id: "skill", sourceRevision: 1, activeVersionId: "active", autoLearnFromAt: new Date("2026-01-01") }), update: vi.fn() },
      writingSkillSource: { findUnique: vi.fn().mockResolvedValue({ mode: "auto" }), delete: vi.fn() },
      writingSkillVersion: { findUnique: vi.fn().mockResolvedValue({ sourceManifest: [{ contentId: "post", contentHash: "old" }] }) },
      aiJob: { create: vi.fn() },
    };
    const service = new WritingSkillService({} as never, {} as never);
    await service.syncPublishedContent(tx as never, {
      id: "post", authorId: "owner", status: "published", visibility: "private", publishedAt: new Date("2026-02-01"), body: "短文", tags: [],
    });
    expect(tx.writingSkillSource.delete).toHaveBeenCalled();
    expect(tx.writingSkill.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      sourceRevision: { increment: 1 }, pauseReason: expect.any(String),
    }) }));
    expect(tx.aiJob.create).not.toHaveBeenCalled();
  });

  it("refreshes an additive source while preserving author-locked fields", async () => {
    const common = { structure: "先给结论", opening: "从问题切入", transitions: "接着说明", ending: "总结建议", tone: "作者确认的语气", viewpoint: "第一人称", diction: "口语表达" };
    const method = { ...common, tone: "模型提取的语气" };
    const activeVersion = { id: "active", profile: { schemaVersion: 1, summary: "当前写法", common, topics: [], authorLockedPaths: ["common.tone"] } };
    const skill = { id: "skill", userId: "owner", activeVersionId: "active", activeVersion, sourceRevision: 5, appliedRevision: 4, editRevision: 2, pauseReason: null, autoLearnFromAt: new Date("2026-01-01") };
    const content = { id: "post", authorId: "owner", title: "旅行记录", body: "真实体验正文", tags: ["旅行"], status: "published", visibility: "public", publishedAt: new Date("2026-02-01") };
    const contentHash = createHash("sha256").update(content.body).digest("hex");
    const source = { contentId: "post", mode: "auto", contentHash, extractedProfile: method, content };
    const tx = {
      writingSkill: { findFirst: vi.fn().mockResolvedValue(skill), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      writingSkillSource: { findMany: vi.fn().mockResolvedValue([{ ...source, content: { ...content, body: content.body } }]), update: vi.fn() },
      writingSkillVersion: { aggregate: vi.fn().mockResolvedValue({ _max: { versionNo: 1 } }), create: vi.fn().mockResolvedValue({ id: "refreshed" }) },
    };
    const prisma = {
      writingSkill: { findFirst: vi.fn().mockResolvedValue(skill), updateMany: vi.fn() },
      writingSkillSource: { findMany: vi.fn().mockResolvedValue([source]) },
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
    };
    const service = new WritingSkillService(prisma as never, {} as never);
    const result = await service.refreshAuto("owner", "skill", 5);
    expect(result).toEqual({ refreshed: true, activeVersionId: "refreshed", sourceRevision: 5 });
    expect(tx.writingSkillVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      origin: "auto_refresh", profile: expect.objectContaining({ common: expect.objectContaining({ tone: "作者确认的语气" }) }),
    }) }));
    expect(tx.writingSkill.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sourceRevision: 5, editRevision: 2, activeVersionId: "active", pauseReason: null }),
      data: expect.objectContaining({ activeVersionId: "refreshed", appliedRevision: 5 }),
    }));
  });

  it("lists full-body eligibility without returning source article text", async () => {
    const prisma = {
      content: {
        findMany: vi.fn().mockResolvedValue([
          { id: "short", title: "短文", body: "完整正文", bodyHtml: null, bodyJson: null, visibility: "private", publishedAt: new Date() },
          { id: "long", title: "长文", body: "x".repeat(1001), bodyHtml: null, bodyJson: null, visibility: "public", publishedAt: new Date() },
        ]),
        count: vi.fn().mockResolvedValue(2),
      },
    };
    const service = new WritingSkillService(prisma as never, {} as never);
    const result = await service.eligible("owner", 1, 20);
    expect(result.items.map((item) => [item.id, item.eligible, item.characterCount])).toEqual([
      ["short", true, 4], ["long", false, 1001],
    ]);
    expect(result.items[0]).not.toHaveProperty("body");
    expect(prisma.content.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { authorId: "owner", status: "published" } }));
  });

  it.each([2, 21])("rejects a %i-source build before making model or database calls", async (count) => {
    const findMany = vi.fn();
    const complete = vi.fn();
    const service = new WritingSkillService({ content: { findMany } } as never, { complete } as never);
    await expect(service.buildCandidate("owner", Array.from({ length: count }, (_, index) => `source-${index}`))).rejects.toThrow("请选择 3 到 20 篇不同的文章");
    expect(findMany).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects sources that are not all owned published short articles", async () => {
    const content = { findMany: vi.fn().mockResolvedValue([{ id: "one", title: "文章", body: "正文" }]) };
    const writingSkill = { upsert: vi.fn() };
    const service = new WritingSkillService({ content, writingSkill } as never, {} as never);
    await expect(service.buildCandidate("owner", ["one", "two", "three"])).rejects.toThrow("所选文章必须是本人已发布且正文不超过 1000 字的文章");
    expect(writingSkill.upsert).not.toHaveBeenCalled();
  });

  it("rejects confirmation when a candidate source is no longer current", async () => {
    const candidateVersion = {
      id: "candidate", sourceRevision: 1, profile: {
        schemaVersion: 1, summary: "总结", common: { structure: "结构", opening: "开头", transitions: "过渡", ending: "结尾", tone: "语气", viewpoint: "视角", diction: "用词" }, topics: [], authorLockedPaths: [],
      }, sourceManifest: [{ contentId: "source-1", contentHash: "old-hash" }],
    };
    const tx = {
      writingSkill: { findUnique: vi.fn().mockResolvedValue({ id: "skill", sourceRevision: 1, editRevision: 0, candidateVersion }) },
      content: { findMany: vi.fn().mockResolvedValue([]) },
      writingSkillSource: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const prisma = { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) };
    const service = new WritingSkillService(prisma as never, {} as never);
    await expect(service.confirm("owner", "candidate", candidateVersion.profile, 1, 0)).rejects.toThrow("来源文章已变化，请重新生成候选");
  });
});
