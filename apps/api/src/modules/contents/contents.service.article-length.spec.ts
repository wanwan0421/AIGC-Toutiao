import { ContentStatus, ContentVisibility } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../common/app-error";
import { ContentsService } from "./contents.service";

const userId = "author-1";
const contentId = "content-1";
const limitTitle = "题".repeat(25);
const overTitle = "题".repeat(26);
const limitBody = "文".repeat(1000);
const overBody = "文".repeat(1001);

function contentFixture(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-10-14T00:00:00.000Z");
  return {
    id: contentId,
    authorId: userId,
    title: "原有标题",
    body: "原有正文",
    bodyHtml: null,
    bodyJson: null,
    excerpt: "原有正文",
    status: ContentStatus.draft,
    visibility: ContentVisibility.public,
    tags: [],
    qualityScore: 0,
    heatScore: 0,
    viewCount: 0,
    likeCount: 0,
    collectCount: 0,
    publishedAt: null,
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
    author: { id: userId, nickname: "作者", avatarUrl: null },
    assets: [],
    _count: { comments: 0 },
    ...overrides,
  };
}

function makeService(initial = contentFixture()) {
  let stored: Record<string, unknown> = initial;
  const content = {
    findUnique: vi.fn(async () => stored),
    findUniqueOrThrow: vi.fn(async () => stored),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      // Prisma leaves omitted relation fields out of the returned included record.
      const provided = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
      stored = contentFixture(provided);
      return stored;
    }),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      stored = { ...stored, ...data };
      return { count: 1 };
    }),
  };
  const contentVersion = {
    findFirst: vi.fn(async () => null as Record<string, unknown> | null),
    aggregate: vi.fn(async () => ({ _max: { version: null as number | null } })),
    create: vi.fn(async () => ({ id: "version-1" })),
  };
  const writingSkillSource = { findMany: vi.fn(async () => [] as { skillId: string }[]) };
  const tx = { content, contentVersion, writingSkillSource };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const reviewPolicy = {
    statusDataForSafetySensitiveEdit: vi.fn(() => ({ status: ContentStatus.draft })),
  };
  const heatScores = { normalizeContent: vi.fn(async (value: unknown) => value) };
  const service = new ContentsService(prisma as never, {} as never, reviewPolicy as never, heatScores as never);
  return { service, prisma, content, contentVersion, record: () => stored };
}

async function expectArticleLengthError(work: Promise<unknown>) {
  await expect(work).rejects.toMatchObject({
    code: "ARTICLE_LENGTH_EXCEEDED",
    statusCode: 422,
  } satisfies Partial<AppError>);
}

describe("ContentsService article length write gates", () => {
  it("creates a draft at the exact 25-character title and 1000-character body limits", async () => {
    const { service, content, record } = makeService();

    await service.create(userId, { title: limitTitle, body: limitBody });

    expect(content.create).toHaveBeenCalledOnce();
    expect(record()).toMatchObject({ title: limitTitle, body: limitBody });
  });

  it.each([
    ["26-character title", overTitle, limitBody],
    ["1001-character body", limitTitle, overBody],
  ])("rejects create with a %s before writing", async (_case, title, body) => {
    const { service, prisma, content, contentVersion } = makeService();

    await expectArticleLengthError(service.create(userId, { title, body }));

    expect(content.create).not.toHaveBeenCalled();
    expect(contentVersion.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("updates at the exact title and body limits, saving one prior version", async () => {
    const { service, content, contentVersion, record } = makeService();

    await service.update(userId, contentId, { title: limitTitle, body: limitBody });

    expect(contentVersion.create).toHaveBeenCalledOnce();
    expect(content.updateMany).toHaveBeenCalledOnce();
    expect(record()).toMatchObject({ title: limitTitle, body: limitBody });
  });

  it.each([
    ["26-character title", { title: overTitle }],
    ["1001-character body", { body: overBody }],
  ])("rejects update with a %s without a new version or partial update", async (_case, patch) => {
    const { service, prisma, content, contentVersion, record } = makeService();
    const before = { ...record() };

    await expectArticleLengthError(service.update(userId, contentId, patch));

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(contentVersion.create).not.toHaveBeenCalled();
    expect(content.updateMany).not.toHaveBeenCalled();
    expect(record()).toEqual(before);
  });

  it("rolls back to a version at the exact title and body limits", async () => {
    const { service, content, contentVersion, record } = makeService();
    contentVersion.findFirst.mockResolvedValueOnce({
      title: limitTitle,
      body: limitBody,
      bodyHtml: null,
      bodyJson: null,
    });

    await service.rollback(userId, contentId, 1);

    expect(contentVersion.create).toHaveBeenCalledOnce();
    expect(content.updateMany).toHaveBeenCalledOnce();
    expect(record()).toMatchObject({ title: limitTitle, body: limitBody });
  });

  it.each([
    ["26-character title", overTitle, limitBody],
    ["1001-character body", limitTitle, overBody],
  ])("rejects rollback to a version with a %s without creating another version", async (_case, title, body) => {
    const { service, prisma, content, contentVersion, record } = makeService();
    const before = { ...record() };
    contentVersion.findFirst.mockResolvedValueOnce({ title, body, bodyHtml: null, bodyJson: null });

    await expectArticleLengthError(service.rollback(userId, contentId, 1));

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(contentVersion.create).not.toHaveBeenCalled();
    expect(content.updateMany).not.toHaveBeenCalled();
    expect(record()).toEqual(before);
  });

  it("keeps a historical overlong updated article private when switching it to public", async () => {
    const initial = contentFixture({ status: ContentStatus.updated, visibility: ContentVisibility.private, body: overBody });
    const { service, content, record } = makeService(initial);

    await expectArticleLengthError(service.updateVisibility(userId, contentId, "public"));

    expect(content.updateMany).not.toHaveBeenCalled();
    expect(record().visibility).toBe(ContentVisibility.private);
  });
});
