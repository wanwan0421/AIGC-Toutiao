import { describe, expect, it, vi } from "vitest";
import { GenerateContentUseCase } from "./generate-content.use-case";

describe("GenerateContentUseCase material input", () => {
  it("passes the entire selected document and reference text to the writing model, but no image IDs", async () => {
    const run = vi.fn(async (_request: unknown) => ({
      title: "旅行", titleCandidates: [], bodyMarkdown: "正文", tags: [], outline: [],
      coverSuggestion: "", imagePrompts: [], imageAssets: [],
    }));
    const useCase = new GenerateContentUseCase({ run } as never, {} as never);
    await useCase.execute({
      theme: "旅行", materialSnapshot: {
        schemaVersion: 1, currentRequest: "旅行", materialNotes: "今天下雨",
        attachmentAssetIds: ["image-1"],
        materialDocuments: [{ assetId: "doc-1", fileName: "行程.md", mimeType: "text/markdown", fullText: "甲".repeat(8_100) + "尾部唯一信息", fileHash: "a".repeat(64), auditedHash: "a".repeat(64) }],
        referenceContents: [{ contentId: "post-1", title: "旧游记", body: "旧文全文", contentHash: "b".repeat(64) }],
      },
    }, { userId: "author-1", source: "button" });
    const request = run.mock.calls[0][0] as Record<string, unknown>;
    expect(request.materialNotes).toContain("尾部唯一信息");
    expect(request.materialNotes).toContain("旧文全文");
    expect(JSON.stringify(request)).not.toContain("image-1");
  });

  it("preserves the author's original chat request when a nested model proposes a different theme", async () => {
    const run = vi.fn(async (_request: unknown) => ({
      title: "旅行", titleCandidates: [], bodyMarkdown: "正文", tags: [], outline: [],
      coverSuggestion: "", imagePrompts: [], imageAssets: [],
    }));
    const useCase = new GenerateContentUseCase({ run } as never, {} as never);
    await useCase.execute({
      theme: "模型整理后的主题", source: "conversation",
      materialSnapshot: {
        schemaVersion: 1, currentRequest: "作者原话：写一篇雨天骑行游记", materialNotes: "",
        attachmentAssetIds: [], materialDocuments: [], referenceContents: [],
      },
    }, { userId: "author-1", source: "conversation" });
    expect((run.mock.calls[0][0] as { materialNotes: string }).materialNotes)
      .toContain("作者原话：写一篇雨天骑行游记");
  });

  it("passes the selected frozen style method into the requirement and draft pipeline request", async () => {
    const run = vi.fn(async (_request: unknown) => ({
      title: "旅行", titleCandidates: [], bodyMarkdown: "正文", tags: [], outline: [],
      coverSuggestion: "", imagePrompts: [], imageAssets: [],
    }));
    const useCase = new GenerateContentUseCase({ run } as never, {} as never);
    await useCase.execute({
      theme: "周末短途旅行",
      writingStyleSnapshot: {
        schemaVersion: 1, skillId: "skill-1", versionId: "version-2", sourceRevision: 4, editRevision: 2,
        mode: "common", profile: {
          schemaVersion: 1, summary: "真实体验，表达克制。",
          common: { structure: "先给结论，再说过程", opening: "从现场细节开始", transitions: "按时间推进", ending: "回到个人建议", tone: "克制", viewpoint: "第一人称", diction: "短句" },
          topics: [], authorLockedPaths: [],
        }, sourceManifest: [{ contentId: "source-1", contentHash: "c".repeat(64) }],
      },
    }, { userId: "author-1", source: "button" });
    const request = run.mock.calls[0][0] as { writingStyleContext?: string };
    expect(request.writingStyleContext).toContain("先给结论，再说过程");
    expect(request.writingStyleContext).toContain("本次创作要求和本次素材优先");
  });
});
