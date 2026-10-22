import { z } from "zod";

const documentSnapshot = z.object({
  assetId: z.string().min(1),
  fileName: z.string(),
  mimeType: z.string(),
  fullText: z.string(),
  fileHash: z.string().regex(/^[0-9a-f]{64}$/),
  auditedHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const referenceSnapshot = z.object({
  contentId: z.string().min(1),
  title: z.string(),
  body: z.string(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const generationMaterialSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  attachmentAssetIds: z.array(z.string().min(1)).max(10),
  materialDocuments: z.array(documentSnapshot).max(3),
  referenceContents: z.array(referenceSnapshot).max(5),
  materialNotes: z.string(),
  currentRequest: z.string(),
}).strict();

export type GenerationMaterialSnapshot = z.infer<typeof generationMaterialSnapshotSchema>;

/** Only text selected by the author is sent to text models; images stay as attachments. */
export function modelMaterialContext(snapshot?: GenerationMaterialSnapshot) {
  if (!snapshot) return "";
  const sections = [
    snapshot.materialNotes ? `本次文字素材：\n${snapshot.materialNotes}` : "",
    ...snapshot.materialDocuments.map((document) => `本次文档《${document.fileName}》全文：\n${document.fullText}`),
    ...snapshot.referenceContents.map((content) => `本次参考旧文《${content.title}》全文：\n${content.body}`),
  ];
  return sections.filter(Boolean).join("\n\n");
}
