import { ContentStatus, ContentVisibility } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ContentWorkflowEngine } from "./content-workflow.engine";

describe("ContentWorkflowEngine quality scoring", () => {
  it("restores an incorrectly downgraded draft when its current audit hash is still valid", async () => {
    const now = new Date("2026-08-26T06:31:15.000Z");
    let status: ContentStatus = ContentStatus.draft;
    let qualityScore = 0;
    const content = () => ({
      id: "content-1",
      authorId: "user-1",
      title: "Title",
      body: "Body",
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
    const prisma = {
      content: {
        findUnique: vi.fn(async () => content()),
        updateMany: vi.fn(async () => {
          status = ContentStatus.approved;
          return { count: 1 };
        }),
        update: vi.fn(async () => {
          qualityScore = quality.total;
          return content();
        }),
      },
      qualityScore: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: "quality-1" })),
      },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
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
      heatScores as never
    );

    const result = await engine.scoreQuality("user-1", "content-1", { aiJobId: "job-1" });

    expect(prisma.content.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: ContentStatus.approved },
    }));
    expect(qualityScoring.run).toHaveBeenCalledOnce();
    expect(result.content.status).toBe(ContentStatus.approved);
    expect(result.quality.total).toBe(88);
  });
});
