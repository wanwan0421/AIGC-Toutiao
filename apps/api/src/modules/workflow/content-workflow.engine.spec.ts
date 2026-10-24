import { createHash } from "node:crypto";
import { AssetAuditStatus, ContentStatus, ContentVisibility } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ContentWorkflowEngine } from "./content-workflow.engine";

describe("ContentWorkflowEngine quality scoring", () => {
  it("restores an incorrectly downgraded draft when its current audit hash is still valid", async () => {
    const now = new Date("2026-08-26T06:31:15.000Z");
    let status: ContentStatus = ContentStatus.draft;
    let qualityScore = 0;
    let body = "Body";
    const content = () => ({
      id: "content-1",
      authorId: "user-1",
      title: "Title",
      body,
      bodyHtml: "<p>Body</p>",
      bodyJson: { type: "doc", content: [] },
      excerpt: "Body",
      status,
      visibility: ContentVisibility.public,
      tags: [],
      qualityScore,
      heatScore: 0,
      viewCount: 0,
      likeCount: 0,
      collectCount: 0,
      clickCount: 0,
      publishedAt: null,
      scheduledAt: null,
      createdAt: now,
      updatedAt: now,
      author: { id: "user-1", nickname: "User", avatarUrl: null },
      assets: [],
    });
    const quality = {
      total: 88,
      dimensions: { structure: 18, clarity: 18, value: 18, attraction: 17, compliance: 17 },
      reason: "good",
    };
    const qualityRecords: Array<Record<string, unknown>> = [];
    const prisma = {
      content: {
        findUnique: vi.fn(async () => content()),
        updateMany: vi.fn(async ({ data }: { data: { status?: ContentStatus; qualityScore?: number } }) => {
          if (data.status) status = data.status;
          if (data.qualityScore !== undefined) qualityScore = data.qualityScore;
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn(async () => content()),
        update: vi.fn(async () => {
          qualityScore = quality.total;
          return content();
        }),
      },
      qualityScore: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async ({ where }: { where: { contentId: string; contentHash: string } }) =>
          qualityRecords.find((item) => item.contentId === where.contentId && item.contentHash === where.contentHash) ?? null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const record = { id: `quality-${qualityRecords.length + 1}`, ...data, createdAt: now };
          qualityRecords.push(record);
          return record;
        }),
      },
      $transaction: vi.fn(async (work: ((tx: unknown) => Promise<unknown>) | Array<Promise<unknown>>) =>
        typeof work === "function" ? work(prisma) : Promise.all(work)),
    };
    const reviewPolicy = {
      getCurrentAuditState: vi.fn(async () => ({ valid: true, currentHash: "same-hash" })),
      assertCurrentContentAuditPassed: vi.fn(async () => undefined),
    };
    const qualityScoring = { run: vi.fn(async () => quality) };
    const heatScores = { normalizeContent: vi.fn(async (value: unknown) => value) };
    const engine = new ContentWorkflowEngine(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      qualityScoring as never,
      reviewPolicy as never,
      heatScores as never,
      {} as never,
      {} as never
    );

    const result = await engine.scoreQuality("user-1", "content-1", { aiJobId: "job-1" });

    expect(prisma.content.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: ContentStatus.approved },
    }));
    expect(qualityScoring.run).toHaveBeenCalledOnce();
    expect(result.content.status).toBe(ContentStatus.approved);
    expect(result.quality.total).toBe(88);

    const cachedResult = await engine.scoreQuality("user-1", "content-1", { aiJobId: "job-2" });
    expect(qualityScoring.run).toHaveBeenCalledOnce();
    expect(cachedResult.quality.total).toBe(88);

    body = "Edited body";
    await engine.scoreQuality("user-1", "content-1", { aiJobId: "job-3" });
    expect(qualityScoring.run).toHaveBeenCalledTimes(2);
  });
});

describe("ContentWorkflowEngine image moderation", () => {
  it("runs text with at most two image reviews and reuses terminal results by byte hash after body edits", async () => {
    const imageBuffers = [Buffer.from("image-a"), Buffer.from("image-b"), Buffer.from("image-c")];
    const imageAssets = imageBuffers.map((_, index) => ({
      id: `image-${index}`,
      fileName: `image-${index}.png`,
      mimeType: "image/png",
      url: `/image-${index}.png`,
      metadata: { storageKey: `image-${index}` },
      auditStatus: AssetAuditStatus.pending,
      auditReason: null,
      riskLevel: null,
      riskTypes: [],
    }));
    const content = {
      id: "content-cache-test",
      authorId: "user-1",
      title: "Title",
      body: "Body v1",
      bodyHtml: "<p>Body</p>",
      bodyJson: null,
      excerpt: "Body",
      status: ContentStatus.draft,
      visibility: ContentVisibility.public,
      tags: [],
      assets: imageAssets.map((asset, sortOrder) => ({ assetId: asset.id, sortOrder, asset })),
      author: { id: "user-1", nickname: "User", avatarUrl: null },
      qualityScore: 0,
      heatScore: 0,
      viewCount: 0,
      likeCount: 0,
      collectCount: 0,
      clickCount: 0,
      publishedAt: null,
      scheduledAt: null,
      createdAt: new Date("2026-08-26T06:31:15.000Z"),
      updatedAt: new Date("2026-08-26T06:31:15.000Z"),
    };
    const cachedByHash = new Map<string, Record<string, unknown>>();
    const cachedTextByHash = new Map<string, Record<string, unknown>>();
    let activeImages = 0;
    let maxActiveImages = 0;
    let imageReviewCalls = 0;
    let textReviewCalls = 0;
    let textReviewActive = false;
    let textImageOverlap = false;
    const audit = { passed: true, riskLevel: "low", riskTypes: [], reasons: [], rewriteAvailable: false, riskItems: [], categoryScores: {} };
    const prisma = {
      content: {
        findUnique: vi.fn(async () => content),
        update: vi.fn(async () => ({ ...content, status: ContentStatus.approved })),
      },
      auditRecord: {
        findFirst: vi.fn(async () => null),
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: "audit-new", createdAt: new Date() })),
      },
      imageModerationCache: {
        findUnique: vi.fn(async ({ where }: { where: { sha256_policyVersion: { sha256: string } } }) => cachedByHash.get(where.sha256_policyVersion.sha256) ?? null),
        upsert: vi.fn(async ({ where, create }: { where: { sha256_policyVersion: { sha256: string } }; create: Record<string, unknown> }) => {
          const sha256 = where.sha256_policyVersion.sha256;
          const result = { ...create, id: `cache-${sha256}` };
          cachedByHash.set(sha256, result);
          return result;
        }),
      },
      contentReviewTextCheckpoint: {
        findUnique: vi.fn(async ({ where }: { where: { contentId_textHash: { textHash: string } } }) => cachedTextByHash.get(where.contentId_textHash.textHash) ?? null),
        upsert: vi.fn(async ({ where, create }: { where: { contentId_textHash: { textHash: string } }; create: Record<string, unknown> }) => {
          cachedTextByHash.set(where.contentId_textHash.textHash, create);
          return create;
        }),
      },
      asset: {
        update: vi.fn(async () => undefined),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const engine = new ContentWorkflowEngine(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { reviewWithRewrite: vi.fn(async () => {
        textReviewCalls += 1;
        textReviewActive = true;
        await new Promise((resolve) => setTimeout(resolve, 10));
        textReviewActive = false;
        return { audit, rewrite: null };
      }) } as never,
      {} as never,
      { computeContentReviewHash: vi.fn((current: typeof content) => current.body) } as never,
      { normalizeContent: vi.fn(async (value: unknown) => value) } as never,
      { reviewImage: vi.fn(async () => {
        imageReviewCalls += 1;
        if (textReviewActive) textImageOverlap = true;
        activeImages += 1;
        maxActiveImages = Math.max(maxActiveImages, activeImages);
        if (imageReviewCalls === 3) {
          activeImages -= 1;
          return { auditStatus: AssetAuditStatus.pending, auditReason: "temporary upstream failure", riskLevel: "unknown", riskTypes: [] };
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeImages -= 1;
        return { auditStatus: AssetAuditStatus.approved, auditReason: null, riskLevel: "low", riskTypes: [] };
      }) } as never,
      { readBuffer: vi.fn(async (key: string) => imageBuffers[Number(key.slice(-1))]) } as never,
    );

    await expect(engine.submitReview("user-1", content.id)).rejects.toMatchObject({ code: "IMAGE_REVIEW_UNAVAILABLE" });
    expect(textImageOverlap).toBe(true);
    expect(maxActiveImages).toBe(2);
    expect(imageReviewCalls).toBe(3);
    expect(textReviewCalls).toBe(1);
    expect(prisma.imageModerationCache.upsert).toHaveBeenCalledTimes(2);

    await engine.submitReview("user-1", content.id);

    expect(imageReviewCalls).toBe(4);
    expect(textReviewCalls).toBe(1);
    expect(prisma.imageModerationCache.upsert).toHaveBeenCalledTimes(3);
    expect(prisma.imageModerationCache.findUnique).toHaveBeenCalledTimes(6);
    expect(prisma.asset.updateMany).toHaveBeenCalledTimes(5);

    content.body = "Body v2";
    await engine.submitReview("user-1", content.id);

    expect(imageReviewCalls).toBe(4);
    expect(textReviewCalls).toBe(2);
    expect(prisma.imageModerationCache.findUnique).toHaveBeenCalledTimes(9);
    expect(prisma.asset.updateMany).toHaveBeenCalledTimes(8);
  });

  it("rechecks linked images when a replayed text audit has no current image results", async () => {
    const imageAsset = {
      id: "image-1",
      fileName: "cover.png",
      mimeType: "image/png",
      url: "/api/uploads/cover.png",
      metadata: { storageKey: "assets/cover.png" },
      auditStatus: AssetAuditStatus.pending,
      auditReason: null,
      riskLevel: null,
      riskTypes: [],
      createdAt: new Date("2026-08-26T06:31:15.000Z"),
      source: "upload",
    };
    const content = {
      id: "content-1",
      authorId: "user-1",
      title: "Title",
      body: "Body",
      bodyHtml: "<p>Body</p>",
      bodyJson: null,
      excerpt: "Body",
      status: ContentStatus.draft,
      visibility: ContentVisibility.public,
      tags: [],
      assets: [{ assetId: imageAsset.id, sortOrder: 0, asset: imageAsset }],
      author: { id: "user-1", nickname: "User", avatarUrl: null },
      qualityScore: 0,
      heatScore: 0,
      viewCount: 0,
      likeCount: 0,
      collectCount: 0,
      clickCount: 0,
      publishedAt: null,
      scheduledAt: null,
      createdAt: new Date("2026-08-26T06:31:15.000Z"),
      updatedAt: new Date("2026-08-26T06:31:15.000Z"),
    };
    const oldAudit = {
      id: "audit-1",
      aiJobId: "job-1",
      contentHash: "same-hash",
      passed: true,
      riskLevel: "low",
      riskTypes: [],
      reasons: [],
      rawResponse: {
        audit: { passed: true, riskLevel: "low", riskTypes: [], reasons: [], rewriteAvailable: false, riskItems: [], categoryScores: {} },
        rewrite: null,
        imageAudits: [],
      },
      createdAt: new Date("2026-08-26T06:31:15.000Z"),
    };
    const prisma = {
      content: {
        findUnique: vi.fn(async () => content),
        update: vi.fn(async () => ({ ...content, status: ContentStatus.approved })),
      },
      auditRecord: {
        findFirst: vi.fn(async () => null),
        findUnique: vi.fn(async () => oldAudit),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...oldAudit, ...data })),
        create: vi.fn(),
      },
      asset: {
        update: vi.fn(async ({ data }: { data: Partial<typeof imageAsset> }) => {
          Object.assign(imageAsset, data);
          return imageAsset;
        }),
        updateMany: vi.fn(async ({ data }: { data: Partial<typeof imageAsset> }) => {
          Object.assign(imageAsset, data);
          return { count: 1 };
        }),
      },
      imageModerationCache: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => create),
      },
      contentReviewTextCheckpoint: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => create),
      },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const audit = { passed: true, riskLevel: "low", riskTypes: [], reasons: [], rewriteAvailable: false, riskItems: [], categoryScores: {} };
    const engine = new ContentWorkflowEngine(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { reviewWithRewrite: vi.fn(async () => ({ audit, rewrite: null })) } as never,
      {} as never,
      { computeContentReviewHash: vi.fn(() => "same-hash") } as never,
      { normalizeContent: vi.fn(async (value: unknown) => value) } as never,
      { reviewImage: vi.fn(async () => ({ auditStatus: AssetAuditStatus.approved, auditReason: null, riskLevel: "low", riskTypes: [] })) } as never,
      { readBuffer: vi.fn(async () => Buffer.from("image")) } as never,
    );

    const result = await engine.submitReview("user-1", "content-1", { aiJobId: "job-1" });

    expect(prisma.asset.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: imageAsset.id },
      data: expect.objectContaining({ auditStatus: AssetAuditStatus.approved }),
    }));
    expect(prisma.auditRecord.update).toHaveBeenCalledOnce();
    expect(prisma.auditRecord.create).not.toHaveBeenCalled();
    expect(result.audit.passed).toBe(true);
  });

  it("reuses the final audit for an unchanged snapshot across different job IDs", async () => {
    const imageBytes = Buffer.from("same image bytes");
    const imageSha256 = createHash("sha256").update(imageBytes).digest("hex");
    const imageAsset = {
      id: "image-2",
      fileName: "photo.webp",
      mimeType: "image/webp",
      url: "/api/uploads/photo.webp",
      metadata: { storageKey: "assets/photo.webp" },
      auditStatus: AssetAuditStatus.pending,
    };
    const content = {
      id: "content-2",
      authorId: "user-1",
      title: "Title",
      body: "Body",
      bodyHtml: "<p>Body</p>",
      bodyJson: null,
      tags: [],
      status: ContentStatus.draft,
      assets: [{ assetId: imageAsset.id, sortOrder: 0, asset: imageAsset }],
      author: { id: "user-1", nickname: "User", avatarUrl: null },
      qualityScore: 0,
      heatScore: 0,
      viewCount: 0,
      likeCount: 0,
      collectCount: 0,
      clickCount: 0,
      publishedAt: null,
      scheduledAt: null,
      createdAt: new Date("2026-08-26T06:31:15.000Z"),
      updatedAt: new Date("2026-08-26T06:31:15.000Z"),
    };
    const cachedAudit = {
      id: "audit-cached",
      contentId: content.id,
      aiJobId: "previous-job",
      contentHash: "snapshot-hash",
      passed: false,
      riskLevel: "medium",
      riskTypes: ["sensitive"],
      reasons: ["policy risk"],
      rawResponse: {
        audit: { passed: false, riskLevel: "medium", riskTypes: ["sensitive"], reasons: ["policy risk"], rewriteAvailable: true, riskItems: [], categoryScores: {} },
        rewrite: { title: "edited", body: "edited body" },
        imageAudits: [{
          assetId: imageAsset.id,
          fileName: imageAsset.fileName,
          sha256: imageSha256,
          auditStatus: AssetAuditStatus.approved,
          auditReason: null,
          riskLevel: "low",
          riskTypes: [],
        }],
      },
      createdAt: new Date("2026-08-26T06:31:15.000Z"),
    };
    const prisma = {
      content: {
        findUnique: vi.fn(async () => content),
        update: vi.fn(async ({ data }: { data: Partial<typeof content> }) => ({ ...content, ...data })),
      },
      auditRecord: {
        findFirst: vi.fn(async () => cachedAudit),
        findUnique: vi.fn(),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...cachedAudit, id: "audit-reused", createdAt: new Date(), ...data })),
        update: vi.fn(),
      },
      asset: { update: vi.fn(async () => undefined) },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const contentSafety = { reviewWithRewrite: vi.fn() };
    const imageModeration = { reviewImage: vi.fn() };
    const engine = new ContentWorkflowEngine(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      contentSafety as never,
      {} as never,
      { computeContentReviewHash: vi.fn(() => "snapshot-hash") } as never,
      { normalizeContent: vi.fn(async (value: unknown) => value) } as never,
      imageModeration as never,
      { readBuffer: vi.fn(async () => imageBytes) } as never,
    );

    const result = await engine.submitReview("user-1", content.id, { aiJobId: "new-job" });

    expect(prisma.auditRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { contentId: content.id, contentHash: "snapshot-hash" },
    }));
    expect(contentSafety.reviewWithRewrite).not.toHaveBeenCalled();
    expect(imageModeration.reviewImage).not.toHaveBeenCalled();
    expect(prisma.asset.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: imageAsset.id },
      data: expect.objectContaining({ auditStatus: AssetAuditStatus.approved }),
    }));
    expect(prisma.auditRecord.create).toHaveBeenCalledOnce();
    expect(result.audit.passed).toBe(false);
    expect(result.rewrite?.title).toBe("edited");
    expect(result.content.status).toBe(ContentStatus.rejected);
  });
});
