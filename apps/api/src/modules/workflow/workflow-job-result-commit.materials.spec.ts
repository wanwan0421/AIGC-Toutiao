import { describe, expect, it, vi } from "vitest";
import { AiJobStatus, AiJobType } from "@aicp/shared";
import { WorkflowJobResultCommitService } from "./workflow-job-result-commit.service";

describe("WorkflowJobResultCommitService frozen attachments", () => {
  it("rechecks frozen materials and persists selected images without attaching text documents", async () => {
    const snapshot = {
      schemaVersion: 1,
      attachmentAssetIds: ["uploaded-image"],
      materialDocuments: [{ assetId: "document", fileName: "notes.md", mimeType: "text/markdown", fullText: "全文", fileHash: "a".repeat(64), auditedHash: "a".repeat(64) }],
      referenceContents: [], materialNotes: "", currentRequest: "旅行",
    };
    const writingStyleSnapshot = { schemaVersion: 1, skillId: "skill-1", versionId: "version-1", mode: "common" };
    const job = { id: "job-1", userId: "author-1", type: AiJobType.CreativeDirectGenerate, status: AiJobStatus.AwaitingCommit, contentId: null, input: { materialSnapshot: snapshot, writingStyleSnapshot } };
    const tx = {
      aiJob: { findFirst: vi.fn(async () => job) },
      aiJobEvent: { findFirst: vi.fn(async () => ({ id: 1n })) },
    };
    const prisma = {
      aiJob: { findFirst: vi.fn(async () => ({ status: AiJobStatus.AwaitingCommit, input: job.input })) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(tx)),
    };
    const sentinel = new Error("stop after inspecting persistence input");
    const persistInTransaction = vi.fn(async () => { throw sentinel; });
    const assertCurrent = vi.fn(async () => undefined);
    const assertStyleCurrent = vi.fn(async () => undefined);
    const assertStyleCurrentInTransaction = vi.fn(async () => undefined);
    const service = new WorkflowJobResultCommitService(
      prisma as never, { persistInTransaction } as never, {} as never, { assertCurrent } as never,
      { assertCurrent: assertStyleCurrent, assertCurrentInTransaction: assertStyleCurrentInTransaction } as never,
    );
    await expect(service.commit("author-1", "job-1", {
      resultEventId: "1",
      content: { title: "旅程", body: "正文", tags: [], assetIds: ["generated-cover"], payload: {} },
    })).rejects.toBe(sentinel);
    expect(assertCurrent).toHaveBeenCalledWith("author-1", snapshot);
    expect(assertStyleCurrent).toHaveBeenCalledWith("author-1", writingStyleSnapshot);
    expect(assertStyleCurrentInTransaction).toHaveBeenCalledWith(tx, "author-1", writingStyleSnapshot);
    expect(persistInTransaction).toHaveBeenCalledWith(tx, "author-1", expect.objectContaining({ assetIds: ["generated-cover", "uploaded-image"] }));
  });
});
