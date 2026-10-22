import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WritingStyleContextResolver, formatWritingStyleContext } from "./writing-style-context-resolver.service";

const profile = {
  schemaVersion: 1 as const,
  summary: "以真实体验展开，语气直接。",
  common: { structure: "先结论再展开", opening: "从具体场景开头", transitions: "自然转折", ending: "回到个人判断", tone: "克制", viewpoint: "第一人称", diction: "短句" },
  topics: [{ key: "travel", label: "旅行", sampleCount: 2, method: { structure: "路线后补体验", opening: "从出发前的困惑切入", transitions: "按行程推进", ending: "给出适用人群", tone: "轻松", viewpoint: "第一人称", diction: "口语" } }],
  authorLockedPaths: [],
};
const contentHash = createHash("sha256").update("source body").digest("hex");
const sourceManifest = [{ contentId: "source-1", contentHash }];

function makePrisma(sourceMode: "manual" | "excluded" = "manual") {
  const tx = {
    writingSkillVersion: { findFirst: vi.fn().mockResolvedValue({ id: "version-1", profile, sourceManifest, sourceRevision: 3, editRevision: 1 }) },
    writingSkill: { findFirst: vi.fn().mockResolvedValue({ id: "skill-1" }) },
    content: { findMany: vi.fn().mockResolvedValue([{ id: "source-1", body: "source body" }]) },
    writingSkillSource: { findMany: vi.fn().mockResolvedValue([{ contentId: "source-1", mode: sourceMode, contentHash }]) },
  };
  const prisma = {
    writingSkill: { findUnique: vi.fn().mockResolvedValue({
      id: "skill-1", userId: "owner", activeVersionId: "version-1", sourceRevision: 3, editRevision: 1, pauseReason: null,
      activeVersion: { id: "version-1", profile, sourceManifest, sourceRevision: 3, editRevision: 1 },
    }) },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => Promise.resolve(callback(tx))),
    aiJob: { findFirst: vi.fn() },
  };
  return { prisma, tx };
}

describe("WritingStyleContextResolver", () => {
  it("does not load a profile when style is off", async () => {
    const { prisma } = makePrisma();
    const resolver = new WritingStyleContextResolver(prisma as never);
    await expect(resolver.resolve("owner", { mode: "off" })).resolves.toBeUndefined();
    expect(prisma.writingSkill.findUnique).not.toHaveBeenCalled();
  });

  it("freezes the selected version and topic in an owned, current snapshot", async () => {
    const { prisma } = makePrisma();
    const resolver = new WritingStyleContextResolver(prisma as never);
    const snapshot = await resolver.resolve("owner", { mode: "topic", topicKey: "travel" }, "version-1");
    expect(snapshot).toMatchObject({ skillId: "skill-1", versionId: "version-1", sourceRevision: 3, editRevision: 1, mode: "topic", topicKey: "travel" });
    expect(formatWritingStyleContext(snapshot)).toContain("路线后补体验");
  });

  it("rejects an explicitly withdrawn source before a queued job can run", async () => {
    const { prisma } = makePrisma("excluded");
    const resolver = new WritingStyleContextResolver(prisma as never);
    const snapshot = await resolver.resolve("owner", { mode: "common" }, "version-1").catch(() => undefined);
    if (snapshot) await expect(resolver.assertCurrent("owner", snapshot)).rejects.toThrow("写作风格来源已撤回、修改或下线");
    else await expect(resolver.resolve("owner", { mode: "common" }, "version-1")).rejects.toThrow("写作风格来源已撤回、修改或下线");
  });

  it("rejects a stale expected version rather than silently using the latest one", async () => {
    const { prisma } = makePrisma();
    const resolver = new WritingStyleContextResolver(prisma as never);
    await expect(resolver.resolve("owner", { mode: "common" }, "old-version")).rejects.toThrow("写作风格版本已变化");
  });

  it("inherits the frozen parent chat version for a nested full-generation job", async () => {
    const { prisma } = makePrisma();
    const parentSnapshot = {
      schemaVersion: 1, skillId: "skill-1", versionId: "version-1", sourceRevision: 3, editRevision: 1,
      mode: "common", profile, sourceManifest,
    };
    prisma.aiJob.findFirst.mockResolvedValue({ input: { writingStyleSnapshot: parentSnapshot } } as never);
    const resolver = new WritingStyleContextResolver(prisma as never);
    await expect(resolver.resolve("owner", undefined, undefined, "parent-chat"))
      .resolves.toMatchObject({ versionId: "version-1", mode: "common" });
    expect(prisma.aiJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "parent-chat", userId: "owner", type: "creative_chat" } }));
  });
});
