import { Injectable, NotFoundException } from "@nestjs/common";
import { AssetAuditStatus, ContentStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { countArticleCharacters } from "@aicp/shared";
import { AppError } from "../../common/app-error";
import { validateArticleText } from "../../common/article-length-policy";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { AssetsService } from "../assets/assets.service";
import { generationMaterialSnapshotSchema, type GenerationMaterialSnapshot } from "../ai/generation-material.snapshot";

type MaterialRequest = {
  attachmentAssetIds?: string[];
  assets?: string[];
  materialAssetIds?: string[];
  referenceContentIds?: string[];
  materialNotes?: string;
  message?: string;
  theme?: string;
};

const INPUT_BUDGET = 30_000;

@Injectable()
export class GenerationMaterialResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
  ) {}

  async resolve(userId: string, request: MaterialRequest, parentChatJobId?: string): Promise<GenerationMaterialSnapshot> {
    if (parentChatJobId) {
      const parent = await this.prisma.aiJob.findFirst({
        where: { id: parentChatJobId, userId, type: "creative_chat" },
        select: { input: true },
      });
      if (!parent) throw new NotFoundException("parent chat job not found");
      const parentInput = this.record(parent.input);
      // Pre-phase-2 jobs have no snapshot. Their persisted request is still the
      // sole trusted input; never read material supplied by the child/model.
      const snapshot = parentInput.materialSnapshot
        ? this.parseSnapshot(parentInput.materialSnapshot)
        : await this.resolve(userId, parentInput as MaterialRequest);
      await this.assertCurrent(userId, snapshot);
      this.assertBudget(snapshot, request.theme);
      return snapshot;
    }

    const attachmentAssetIds = this.uniqueIds([...(request.attachmentAssetIds ?? []), ...(request.assets ?? [])], 10, "attachmentAssetIds");
    const materialAssetIds = this.uniqueIds(request.materialAssetIds ?? [], 3, "materialAssetIds");
    const referenceContentIds = this.uniqueIds(request.referenceContentIds ?? [], 5, "referenceContentIds");
    if (attachmentAssetIds.some((id) => materialAssetIds.includes(id))) this.invalid("素材文件不能同时作为图片附件", "materialAssetIds");

    await this.assertAttachments(userId, attachmentAssetIds);
    const materialDocuments = [] as GenerationMaterialSnapshot["materialDocuments"];
    for (const assetId of materialAssetIds) {
      materialDocuments.push(await this.assets.resolveTextMaterial(userId, assetId));
    }
    const referenceContents = [] as GenerationMaterialSnapshot["referenceContents"];
    for (const contentId of referenceContentIds) {
      referenceContents.push(await this.resolveReference(userId, contentId));
    }

    const materialNotes = request.materialNotes ?? "";
    // Direct generation writes with theme, while chat writes with message.
    // The budget must count the field that the model will actually receive.
    const currentRequest = request.theme ?? request.message ?? "";
    const snapshot = generationMaterialSnapshotSchema.parse({
      schemaVersion: 1,
      attachmentAssetIds,
      materialDocuments,
      referenceContents,
      materialNotes,
      currentRequest,
    });
    this.assertBudget(snapshot);
    return snapshot;
  }

  parseSnapshot(value: unknown): GenerationMaterialSnapshot {
    const parsed = generationMaterialSnapshotSchema.safeParse(value);
    if (!parsed.success) this.invalid("任务的素材快照无效", "materialSnapshot");
    return parsed.data;
  }

  /** Run before worker execution and again before committing generated content. */
  async assertCurrent(userId: string, value: unknown) {
    if (value === undefined) return; // Historical queued jobs predate snapshots.
    const snapshot = this.parseSnapshot(value);
    await this.assertAttachments(userId, snapshot.attachmentAssetIds);
    for (const document of snapshot.materialDocuments) {
      await this.assets.assertTextMaterialSnapshotCurrent(userId, document);
    }
    for (const reference of snapshot.referenceContents) {
      const current = await this.resolveReference(userId, reference.contentId);
      if (current.contentHash !== reference.contentHash) {
        throw new AppError({ code: "MATERIAL_SNAPSHOT_STALE", message: "参考旧文已变化，请重新发起创作", statusCode: 409 });
      }
    }
  }

  private async resolveReference(userId: string, contentId: string): Promise<GenerationMaterialSnapshot["referenceContents"][number]> {
    const content = await this.prisma.content.findFirst({ where: { id: contentId, authorId: userId } });
    if (!content) throw new NotFoundException("reference content not found");
    if (content.status !== ContentStatus.published) this.invalid("只能临时参考本人已发布的文章", "referenceContentIds");
    const article = validateArticleText({
      title: "",
      body: content.body,
      bodyHtml: content.bodyHtml,
      bodyJson: this.recordOrNull(content.bodyJson),
    });
    const contentHash = createHash("sha256").update(JSON.stringify({
      title: content.title,
      body: content.body,
      bodyHtml: content.bodyHtml,
      bodyJson: content.bodyJson,
    })).digest("hex");
    return { contentId, title: content.title, body: article.body, contentHash };
  }

  private async assertAttachments(userId: string, ids: string[]) {
    if (!ids.length) return;
    const assets = await this.prisma.asset.findMany({ where: { id: { in: ids }, uploaderId: userId } });
    if (assets.length !== ids.length) throw new NotFoundException("attachment asset not found");
    for (const asset of assets) {
      if (!asset.mimeType.toLowerCase().startsWith("image/") || asset.auditStatus === AssetAuditStatus.rejected) {
        this.invalid("图片附件类型不受支持", "attachmentAssetIds");
      }
    }
  }

  private uniqueIds(ids: string[], max: number, field: string) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id.trim())) this.invalid("素材 ID 格式无效", field);
    if (ids.length > max || new Set(ids).size !== ids.length) this.invalid(`最多选择 ${max} 项且不能重复`, field);
    return ids;
  }

  private assertBudget(snapshot: GenerationMaterialSnapshot, derivedTheme?: string) {
    const extraRequest = derivedTheme && derivedTheme !== snapshot.currentRequest ? countArticleCharacters(derivedTheme) : 0;
    const actual = countArticleCharacters(snapshot.materialNotes) + countArticleCharacters(snapshot.currentRequest) +
      snapshot.materialDocuments.reduce((sum, document) => sum + countArticleCharacters(document.fullText), 0) + extraRequest;
    if (actual > INPUT_BUDGET) {
      throw new AppError({
        code: "MATERIAL_BUDGET_EXCEEDED",
        message: `本次文字素材与要求合计最多 ${INPUT_BUDGET} 字，请移除或缩短素材`,
        statusCode: 422,
        details: { field: "materialNotes+currentRequest+materialDocuments", actual, max: INPUT_BUDGET },
      });
    }
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private recordOrNull(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  private invalid(message: string, field: string): never {
    throw new AppError({ code: "MATERIAL_INVALID", message, statusCode: 422, details: { field } });
  }
}
