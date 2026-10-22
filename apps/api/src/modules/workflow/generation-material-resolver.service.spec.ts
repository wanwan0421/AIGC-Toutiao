import { describe, expect, it, vi } from "vitest";
import { AssetAuditStatus, ContentStatus } from "@prisma/client";
import { AppError } from "../../common/app-error";
import { modelMaterialContext } from "../ai/generation-material.snapshot";
import { GenerationMaterialResolver } from "./generation-material-resolver.service";

const hash = "a".repeat(64);

function fixture() {
  const document = { assetId: "doc-1", fileName: "游记.md", mimeType: "text/markdown", fullText: "开头\n" + "甲".repeat(8_000) + "尾部唯一信息", fileHash: hash, auditedHash: hash };
  const content = { id: "post-1", authorId: "author-1", status: ContentStatus.published, title: "旧旅行笔记", body: "亲测路线", bodyHtml: null, bodyJson: null };
  const prisma = {
    asset: { findMany: vi.fn(async () => [{ id: "image-1", auditStatus: AssetAuditStatus.pending, mimeType: "image/png" }]) },
    content: { findFirst: vi.fn(async () => content) },
    aiJob: { findFirst: vi.fn() },
  };
  const assets = {
    resolveTextMaterial: vi.fn(async () => document),
    assertTextMaterialSnapshotCurrent: vi.fn(async () => document),
  };
  return { prisma, assets, document, content, resolver: new GenerationMaterialResolver(prisma as never, assets as never) };
}

describe("GenerationMaterialResolver", () => {
  it("freezes complete audited documents, reference articles and attachment IDs without sending images to a text model", async () => {
    const { resolver, document, assets } = fixture();
    const snapshot = await resolver.resolve("author-1", {
      theme: "写一篇新游记", materialNotes: "今天下雨", materialAssetIds: ["doc-1"],
      referenceContentIds: ["post-1"], attachmentAssetIds: ["image-1"],
    });
    expect(snapshot.materialDocuments[0].fullText).toBe(document.fullText);
    expect(snapshot.materialDocuments[0].fullText.endsWith("尾部唯一信息")).toBe(true);
    expect(snapshot.referenceContents[0]).toMatchObject({ contentId: "post-1", body: "亲测路线" });
    expect(snapshot.attachmentAssetIds).toEqual(["image-1"]);
    expect(modelMaterialContext(snapshot)).toContain("尾部唯一信息");
    expect(modelMaterialContext(snapshot)).not.toContain("image-1");
    await resolver.assertCurrent("author-1", snapshot);
    expect(assets.assertTextMaterialSnapshotCurrent).toHaveBeenCalledWith("author-1", expect.objectContaining({ assetId: "doc-1", fileHash: hash }));
  });

  it("rejects the 30000-grapheme budget instead of truncating document text", async () => {
    const { resolver, assets } = fixture();
    assets.resolveTextMaterial.mockResolvedValueOnce({ assetId: "doc-1", fileName: "a.txt", mimeType: "text/plain", fullText: "甲".repeat(30_000), fileHash: hash, auditedHash: hash });
    await expect(resolver.resolve("author-1", { theme: "主题", materialAssetIds: ["doc-1"] }))
      .rejects.toMatchObject({ code: "MATERIAL_BUDGET_EXCEEDED", details: { actual: 30_002, max: 30_000 } });
  });

  it("counts the direct-generation theme that reaches the model, even if message is shorter", async () => {
    const { resolver } = fixture();
    await expect(resolver.resolve("author-1", {
      theme: "甲".repeat(20_000), message: "短消息", materialNotes: "乙".repeat(20_000),
    })).rejects.toMatchObject({ code: "MATERIAL_BUDGET_EXCEEDED", details: { actual: 40_000, max: 30_000 } });
  });

  it("rejects missing or changed reference articles and too many documents", async () => {
    const { resolver, prisma, content } = fixture();
    await expect(resolver.resolve("author-1", { theme: "主题", materialAssetIds: ["1", "2", "3", "4"] }))
      .rejects.toMatchObject({ code: "MATERIAL_INVALID" });
    prisma.content.findFirst.mockResolvedValueOnce(null as never);
    await expect(resolver.resolve("author-1", { theme: "主题", referenceContentIds: ["other-user-post"] }))
      .rejects.toMatchObject({ status: 404 });
    const snapshot = await resolver.resolve("author-1", { theme: "主题", referenceContentIds: ["post-1"] });
    content.body = "正文已经修改";
    await expect(resolver.assertCurrent("author-1", snapshot)).rejects.toMatchObject({ code: "MATERIAL_SNAPSHOT_STALE" });
  });

  it("inherits only the server-owned parent chat snapshot for nested article generation", async () => {
    const { resolver, prisma, assets } = fixture();
    const snapshot = await resolver.resolve("author-1", { message: "按这些素材写文章", materialNotes: "真实见闻", materialAssetIds: ["doc-1"] });
    prisma.aiJob.findFirst.mockResolvedValueOnce({ input: { materialSnapshot: snapshot } } as never);
    assets.resolveTextMaterial.mockClear();
    const inherited = await resolver.resolve("author-1", {
      theme: "标题", message: "模型伪造的要求", materialNotes: "模型伪造的素材", materialAssetIds: ["fake"],
    }, "parent-chat-job");
    expect(inherited).toEqual(snapshot);
    expect(assets.resolveTextMaterial).not.toHaveBeenCalled();
    expect(prisma.aiJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "author-1", id: "parent-chat-job" }) }));
  });

  it("counts a nested article's derived theme alongside the parent's frozen chat request", async () => {
    const { resolver, prisma } = fixture();
    const snapshot = await resolver.resolve("author-1", { message: "请写旅行文章", materialAssetIds: ["doc-1"] });
    prisma.aiJob.findFirst.mockResolvedValueOnce({ input: { materialSnapshot: snapshot } } as never);
    await expect(resolver.resolve("author-1", { theme: "丙".repeat(25_000) }, "parent-chat-job"))
      .rejects.toMatchObject({ code: "MATERIAL_BUDGET_EXCEEDED" });
  });

  it("propagates full-text audit or storage invalidation before execution", async () => {
    const { resolver, assets } = fixture();
    const snapshot = await resolver.resolve("author-1", { theme: "主题", materialAssetIds: ["doc-1"] });
    assets.assertTextMaterialSnapshotCurrent.mockRejectedValueOnce(new AppError({ code: "MATERIAL_SNAPSHOT_STALE", message: "changed", statusCode: 409 }));
    await expect(resolver.assertCurrent("author-1", snapshot)).rejects.toMatchObject({ code: "MATERIAL_SNAPSHOT_STALE" });
  });
});
