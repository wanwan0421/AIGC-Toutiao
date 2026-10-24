import { AssetAuditStatus, AssetTextStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AssetsService } from "./assets.service";
import { decodeTextMaterial, extractTextMaterial, reviewEntireText, textMaterialHash, textMaterialMimeType, TEXT_EXTRACTOR_VERSION } from "./text-material";
import { SafetyRuleEngine } from "../ai/safety/safety-rule-engine.service";
import { SafetyRuleLoader } from "../ai/safety/safety-rule-loader.service";

const approvedAsset = {
  id: "asset-one",
  uploaderId: "author-one",
  fileName: "travel.md",
  mimeType: "text/plain",
  source: "uploaded",
  auditStatus: AssetAuditStatus.approved,
  metadata: { storageKey: "user-assets/travel.md" },
};

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries: Array<[string, string]>) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let localOffset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const checksum = crc32(data);
    const compressed = require("node:zlib").deflateRawSync(data) as Buffer;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(localOffset, 42);
    central.push(record, nameBytes);
    localOffset += header.length + nameBytes.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function makeDocx(text: string) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return makeZip([
    ["[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"xml\" ContentType=\"application/xml\"/></Types>"],
    ["word/document.xml", `<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>${escaped}</w:t></w:r></w:p></w:body></w:document>`],
  ]);
}

function makePdf(text: string, pageCount = 1) {
  const fontObjectId = pageCount + 3;
  const contentObjectId = pageCount + 4;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, (_, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId + index} 0 R >>`),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...Array.from({ length: pageCount }, (_, index) => {
      const pageText = index === 0 ? text : "";
      const stream = `BT /F1 12 Tf 72 720 Td (${pageText.replace(/[()\\]/g, "\\$&")}) Tj ET`;
      return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

function setup(input: { asset?: Record<string, unknown> | null; buffer?: Buffer; extracted?: Record<string, unknown> | null } = {}) {
  const asset = input.asset === undefined ? approvedAsset : input.asset;
  const buffer = input.buffer ?? Buffer.from("第一段\n第二段", "utf8");
  const prisma = {
    asset: { findFirst: vi.fn().mockResolvedValue(asset), create: vi.fn() },
    assetExtractedText: {
      findUnique: vi.fn().mockResolvedValue(input.extracted ?? null),
      upsert: vi.fn().mockResolvedValue(null),
    },
  };
  const storage = {
    readBuffer: vi.fn().mockResolvedValue(buffer),
    saveBuffer: vi.fn().mockResolvedValue({ storageKey: "user-assets/travel.md", url: "/api/uploads/user-assets/travel.md", size: buffer.length }),
    deleteObject: vi.fn().mockResolvedValue(true),
  };
  const safetyRules = {
    scan: vi.fn(({ title, body }: { title: string; body: string }) => ({
      riskItems: title.includes("违规") || body.includes("尾部违规")
        ? [{ severity: "high", reason: "命中禁止内容" }]
        : [],
    })),
  };
  const rateLimit = { consume: vi.fn().mockResolvedValue(undefined) };
  const service = new AssetsService(prisma as never, storage as never, safetyRules as never, {} as never, rateLimit as never);
  return { service, prisma, storage, safetyRules, rateLimit };
}

describe("TXT/MD full-text extraction", () => {
  it("decodes UTF-8 BOM and rejects malformed UTF-8 and binary content", async () => {
    await expect(decodeTextMaterial(Buffer.from([0xef, 0xbb, 0xbf, 0xe6, 0x97, 0x85]))).resolves.toBe("旅");
    await expect(decodeTextMaterial(Buffer.from([0xff]))).rejects.toMatchObject({ code: "MATERIAL_TEXT_DECODE_FAILED" });
    await expect(decodeTextMaterial(Buffer.from([0x41, 0, 0x42]))).rejects.toMatchObject({ code: "MATERIAL_TEXT_DECODE_FAILED" });
    await expect(decodeTextMaterial(Buffer.from("%PDF-1.7\n..."))).rejects.toMatchObject({ code: "MATERIAL_TYPE_UNSUPPORTED" });
    expect(textMaterialMimeType("notes.md", "text/plain")).toBe("text/markdown");
    expect(() => textMaterialMimeType("notes.pdf", "text/plain")).toThrow();
    expect(() => textMaterialMimeType("notes.txt", "text/markdown")).toThrow();
  });

  it("scans content beyond the old 8000-character preview", () => {
    const { safetyRules } = setup();
    const text = `${"正".repeat(8200)}尾部违规`;
    const result = reviewEntireText("travel.md", text, safetyRules as never);
    expect(result.approved).toBe(false);
    expect(safetyRules.scan.mock.calls.some(([input]) => input.body.includes("尾部违规"))).toBe(true);
  });

  it("catches an actual safety rule only in the unpreviewed tail", () => {
    const safetyRules = new SafetyRuleEngine(new SafetyRuleLoader());
    const text = `${"旅行".repeat(4200)}微信:abcde123`;
    expect(reviewEntireText("travel.md", text, safetyRules).approved).toBe(false);
  });

  it("lazily extracts the complete historical file and records its audit hash", async () => {
    const buffer = Buffer.from(`${"旅".repeat(8200)}尾部经验`, "utf8");
    const { service, prisma, storage } = setup({ buffer });
    const result = await service.resolveTextMaterial("author-one", "asset-one");
    expect(result.fullText).toContain("尾部经验");
    expect(result.fullText.length).toBeGreaterThan(8000);
    expect(result.fileHash).toBe(textMaterialHash(buffer));
    expect(result.auditedHash).toBe(result.fileHash);
    expect(storage.readBuffer).toHaveBeenCalledWith("user-assets/travel.md");
    expect(prisma.assetExtractedText.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        fullText: result.fullText,
        status: AssetTextStatus.extracted,
        fullTextAuditStatus: AssetAuditStatus.approved,
        auditedHash: result.fileHash,
      }),
    }));
  });

  it("rejects a historical file with a risky tail and persists the rejected full audit", async () => {
    const { service, prisma } = setup({ buffer: Buffer.from(`${"旅".repeat(8200)}尾部违规`, "utf8") });
    await expect(service.resolveTextMaterial("author-one", "asset-one")).rejects.toMatchObject({ code: "MATERIAL_FULL_TEXT_REJECTED" });
    expect(prisma.assetExtractedText.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ fullTextAuditStatus: AssetAuditStatus.rejected }),
    }));
  });

  it("reuses an approved audit only for the same file hash", async () => {
    const buffer = Buffer.from("已审核全文", "utf8");
    const fileHash = textMaterialHash(buffer);
    const { service, prisma, safetyRules } = setup({
      buffer,
      extracted: {
        fileHash,
        extractorVersion: TEXT_EXTRACTOR_VERSION,
        status: AssetTextStatus.extracted,
        fullText: "已审核全文",
        fullTextAuditStatus: AssetAuditStatus.approved,
        auditedHash: fileHash,
      },
    });
    expect((await service.resolveTextMaterial("author-one", "asset-one")).fullText).toBe("已审核全文");
    expect(prisma.assetExtractedText.upsert).not.toHaveBeenCalled();
    expect(safetyRules.scan).not.toHaveBeenCalled();
    await expect(service.assertTextMaterialSnapshotCurrent("author-one", {
      assetId: "asset-one", fileHash: "old-hash", auditedHash: "old-hash",
    })).rejects.toMatchObject({ code: "MATERIAL_SNAPSHOT_STALE" });
  });

  it("does not reuse the audit after the stored bytes change", async () => {
    const currentBuffer = Buffer.from("新文件正文", "utf8");
    const { service, prisma, safetyRules } = setup({
      buffer: currentBuffer,
      extracted: {
        fileHash: textMaterialHash(Buffer.from("旧文件正文", "utf8")),
        extractorVersion: "utf8-txt-md-v1",
        status: AssetTextStatus.extracted,
        fullText: "旧文件正文",
        fullTextAuditStatus: AssetAuditStatus.approved,
        auditedHash: textMaterialHash(Buffer.from("旧文件正文", "utf8")),
      },
    });
    const result = await service.resolveTextMaterial("author-one", "asset-one");
    expect(result.fullText).toBe("新文件正文");
    expect(safetyRules.scan).toHaveBeenCalled();
    expect(prisma.assetExtractedText.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ auditedHash: textMaterialHash(currentBuffer) }),
    }));
  });

  it("rejects cross-user, pending, URL-only, and missing-storage assets", async () => {
    const crossUser = setup({ asset: null });
    await expect(crossUser.service.resolveTextMaterial("other-user", "asset-one")).rejects.toMatchObject({ status: 404 });
    const pending = setup({ asset: { ...approvedAsset, auditStatus: AssetAuditStatus.pending } });
    await expect(pending.service.resolveTextMaterial("author-one", "asset-one")).rejects.toMatchObject({ code: "MATERIAL_ASSET_NOT_APPROVED" });
    const urlOnly = setup({ asset: { ...approvedAsset, metadata: null } });
    await expect(urlOnly.service.resolveTextMaterial("author-one", "asset-one")).rejects.toMatchObject({ code: "MATERIAL_STORAGE_UNAVAILABLE" });
    const storageMissing = setup();
    storageMissing.storage.readBuffer.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(storageMissing.service.resolveTextMaterial("author-one", "asset-one")).rejects.toMatchObject({ code: "MATERIAL_STORAGE_UNAVAILABLE" });
    expect(storageMissing.prisma.assetExtractedText.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: AssetTextStatus.failed, fullTextAuditStatus: AssetAuditStatus.pending }),
    }));
  });

  it("stores the whole approved text on upload while preview remains short", async () => {
    const buffer = Buffer.from(`${"游".repeat(8200)}尾部经验`, "utf8");
    const { service, prisma } = setup({ buffer });
    prisma.asset.create.mockImplementationOnce(async ({ data }) => ({ id: "new-asset", createdAt: new Date(), ...data }));
    await service.upload("author-one", { originalname: "travel.md", mimetype: "text/plain", buffer, size: buffer.length });
    const data = prisma.asset.create.mock.calls[0][0].data;
    expect(data.mimeType).toBe("text/markdown");
    expect(data.metadata.previewText.length).toBe(8000);
    expect(data.extractedText.create.fullText).toContain("尾部经验");
    expect(data.extractedText.create.auditedHash).toBe(textMaterialHash(buffer));
  });

  it("blocks an upload when only the tail violates the full-text review", async () => {
    const buffer = Buffer.from(`${"游".repeat(8200)}尾部违规`, "utf8");
    const { service, storage, prisma } = setup({ buffer });
    await expect(service.upload("author-one", {
      originalname: "travel.md", mimetype: "text/plain", buffer, size: buffer.length,
    })).rejects.toMatchObject({ code: "MATERIAL_FULL_TEXT_REJECTED" });
    expect(storage.saveBuffer).not.toHaveBeenCalled();
    expect(prisma.asset.create).not.toHaveBeenCalled();
  });
});

describe("PDF/DOCX full-text extraction", () => {
  it("persists extracted DOCX text and full-review hash during upload", async () => {
    const buffer = makeDocx("厦门旅行经验：先预约，再出发。");
    const { service, prisma } = setup({ buffer });
    prisma.asset.create.mockImplementationOnce(async ({ data }) => ({ id: "docx-asset", createdAt: new Date(), ...data }));
    await service.upload("author-one", {
      originalname: "travel.docx",
      mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer,
      size: buffer.length,
    });
    const data = prisma.asset.create.mock.calls[0][0].data;
    expect(data.extractedText.create.fullText).toContain("厦门旅行经验：先预约，再出发。");
    expect(data.extractedText.create.extractorVersion).toBe(TEXT_EXTRACTOR_VERSION);
    expect(data.extractedText.create.auditedHash).toBe(textMaterialHash(buffer));
  });

  it("extracts selectable PDF text and DOCX paragraph text", async () => {
    const pdf = await extractTextMaterial(makePdf("A real travel note"), "travel.pdf", "application/pdf");
    expect(pdf.mimeType).toBe("application/pdf");
    expect(pdf.fullText).toContain("A real travel note");

    const docx = await extractTextMaterial(
      makeDocx("厦门旅行经验：先预约，再出发。"),
      "travel.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(docx.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(docx.fullText).toContain("厦门旅行经验：先预约，再出发。");
  });

  it("rejects a forged MIME, broken file, empty/scanned text and extracted text over the limit", async () => {
    await expect(extractTextMaterial(makePdf("hello"), "notes.docx", "application/pdf"))
      .rejects.toMatchObject({ code: "MATERIAL_TYPE_UNSUPPORTED" });
    await expect(extractTextMaterial(Buffer.from("%PDF broken"), "broken.pdf", "application/pdf"))
      .rejects.toMatchObject({ code: "MATERIAL_PDF_PARSE_FAILED" });
    await expect(extractTextMaterial(makePdf("", 1), "scanned.pdf", "application/pdf"))
      .rejects.toMatchObject({ code: "MATERIAL_DOCUMENT_NO_TEXT" });
    await expect(extractTextMaterial(makePdf("page", 41), "many-pages.pdf", "application/pdf"))
      .rejects.toMatchObject({ code: "MATERIAL_PDF_PAGE_LIMIT" });
    await expect(extractTextMaterial(makeDocx("  "), "empty.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
      .rejects.toMatchObject({ code: "MATERIAL_DOCUMENT_NO_TEXT" });
    await expect(extractTextMaterial(makeDocx("A".repeat(30_001)), "long.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
      .rejects.toMatchObject({ code: "MATERIAL_DOCUMENT_TEXT_TOO_LONG" });
  });

  it("rejects a PDF extension declared as an image before storing it", async () => {
    const buffer = makePdf("travel");
    const { service, storage, prisma } = setup({ buffer });
    await expect(service.upload("author-one", {
      originalname: "travel.pdf", mimetype: "image/png", buffer, size: buffer.length,
    })).rejects.toMatchObject({ code: "MATERIAL_TYPE_UNSUPPORTED" });
    expect(storage.saveBuffer).not.toHaveBeenCalled();
    expect(prisma.asset.create).not.toHaveBeenCalled();
  });

  it("rejects encrypted DOCX and applies the document byte limit", async () => {
    const encrypted = makeDocx("text");
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(1, central + 8);
    await expect(extractTextMaterial(encrypted, "locked.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
      .rejects.toMatchObject({ code: "MATERIAL_DOCX_INVALID" });
    await expect(extractTextMaterial(Buffer.alloc(10 * 1024 * 1024 + 1), "large.pdf", "application/pdf"))
      .rejects.toMatchObject({ code: "MATERIAL_FILE_TOO_LARGE" });
  });
});
