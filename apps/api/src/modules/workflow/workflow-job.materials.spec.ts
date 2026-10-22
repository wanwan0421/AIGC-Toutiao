import { describe, expect, it, vi } from "vitest";
import { AiJobType } from "@aicp/shared";
import { AiJobPayloadValidator } from "./ai-job-payload.validator";
import { WorkflowJobService } from "./workflow-job.service";

describe("WorkflowJobService material snapshots", () => {
  it("persists a bounded server-built snapshot in AiJob.input before dispatch", async () => {
    const materialSnapshot = {
      schemaVersion: 1, attachmentAssetIds: ["image-1"],
      materialDocuments: [{ assetId: "doc-1", fileName: "journey.md", mimeType: "text/markdown", fullText: "全文尾部", fileHash: "a".repeat(64), auditedHash: "a".repeat(64) }],
      referenceContents: [], materialNotes: "亲测", currentRequest: "旅行",
    };
    let storedInput: Record<string, unknown> | undefined;
    const now = new Date();
    const prisma = {
      aiJob: { findFirst: vi.fn(async () => null), count: vi.fn(async () => 0) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
        aiJob: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          storedInput = data.input as Record<string, unknown>;
          return {
            ...data, contentId: null, conversationId: null, assistantMessageId: null,
            progress: 0, currentStep: null, result: null, errorMessage: null, errorCode: null,
            errorRetryable: false, warnings: [], attempts: 0, startedAt: null,
            resultReadyAt: null, appliedAt: null, appliedEventId: null, completedAt: null,
            createdAt: now, updatedAt: now,
          };
        }) },
      })),
    };
    const resolver = { resolve: vi.fn(async () => materialSnapshot) };
    const writingStyleSnapshot = { schemaVersion: 1, skillId: "skill-1", versionId: "version-1", mode: "common" };
    const writingStyleResolver = { resolve: vi.fn(async () => writingStyleSnapshot) };
    const service = new WorkflowJobService(
      prisma as never, {} as never,
      { createInTransaction: vi.fn(async () => ({ id: "1", type: "snapshot", data: {} })), notify: vi.fn(async () => undefined) } as never,
      { dispatchJob: vi.fn(async () => true) } as never,
      {} as never, new AiJobPayloadValidator(),
      { consume: vi.fn(async () => undefined) } as never, {} as never, resolver as never, writingStyleResolver as never,
    );
    await service.create({
      userId: "author-1", type: AiJobType.CreativeDirectGenerate,
      payload: { theme: "旅行", materialAssetIds: ["doc-1"], assets: ["image-1"], materialNotes: "亲测", writingStyle: { mode: "common" }, expectedVersionId: "version-1" },
      idempotencyKey: "direct-1",
    });
    expect(resolver.resolve).toHaveBeenCalledWith("author-1", expect.objectContaining({ materialAssetIds: ["doc-1"] }), undefined);
    expect(storedInput?.materialSnapshot).toEqual(materialSnapshot);
    expect(storedInput?.materialAssetIds).toEqual(["doc-1"]);
    expect(storedInput?.attachmentAssetIds).toEqual(["image-1"]);
    expect(storedInput).not.toHaveProperty("assets");
    expect(writingStyleResolver.resolve).toHaveBeenCalledWith("author-1", { mode: "common" }, "version-1", undefined);
    expect(storedInput?.writingStyleSnapshot).toEqual(writingStyleSnapshot);
    expect(storedInput).not.toHaveProperty("expectedVersionId");
  });
});
