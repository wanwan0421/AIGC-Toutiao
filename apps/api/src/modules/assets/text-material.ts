import { createHash } from "node:crypto";
import { countArticleCharacters } from "@aicp/shared";
import { AppError } from "../../common/app-error";
import type { SafetyRuleEngine } from "../ai/safety/safety-rule-engine.service";
import { fileTypeFromBuffer } from "file-type";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export const TEXT_EXTRACTOR_VERSION = "full-document-v2";
export const MAX_TEXT_MATERIAL_BYTES = 2 * 1024 * 1024;
export const MAX_DOCUMENT_MATERIAL_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_DOCUMENT_CHARACTERS = 30_000;
export const MAX_PDF_PAGES = 40;
const MAX_DOCX_ARCHIVE_ENTRIES = 10_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

const REVIEW_CHUNK_LENGTH = 8192;
const REVIEW_OVERLAP = 256;

function materialError(code: string, message: string) {
  return new AppError({ code, message, statusCode: 422 });
}

export function textMaterialMimeType(fileName: string, declaredMimeType: string) {
  const extension = fileName.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase();
  const mimeType = declaredMimeType.toLowerCase();
  if (extension === "txt" && mimeType === "text/plain") return "text/plain";
  // Browsers commonly report Markdown files as text/plain.
  if ((extension === "md" || extension === "markdown") &&
      ["text/plain", "text/markdown", "text/x-markdown", "application/markdown"].includes(mimeType)) {
    return "text/markdown";
  }
  if (extension === "pdf" && mimeType === "application/pdf") return "application/pdf";
  if (extension === "docx" && mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return mimeType;
  throw materialError("MATERIAL_TYPE_UNSUPPORTED", "仅支持文件名与实际类型一致的 TXT、MD、PDF 或 DOCX 文档");
}

export function textMaterialMaxBytes(fileName: string, declaredMimeType: string) {
  const mimeType = textMaterialMimeType(fileName, declaredMimeType);
  return mimeType === "text/plain" || mimeType === "text/markdown"
    ? MAX_TEXT_MATERIAL_BYTES
    : MAX_DOCUMENT_MATERIAL_BYTES;
}

export function textMaterialHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function decodeTextMaterial(buffer: Buffer) {
  if (buffer.byteLength > MAX_TEXT_MATERIAL_BYTES) {
    throw materialError("MATERIAL_FILE_TOO_LARGE", "TXT/MD 文件不能超过 2 MB");
  }
  const detected = await fileTypeFromBuffer(buffer);
  if (detected) {
    throw materialError("MATERIAL_TYPE_UNSUPPORTED", "文件实际内容不是 TXT/MD 文本");
  }
  let fullText: string;
  try {
    // TextDecoder removes a UTF-8 BOM; fatal decoding rejects malformed bytes.
    fullText = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw materialError("MATERIAL_TEXT_DECODE_FAILED", "文件不是有效 UTF-8 文本，请转换编码后重新上传");
  }
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/u.test(fullText)) {
    throw materialError("MATERIAL_TEXT_DECODE_FAILED", "文件包含不可读取的二进制控制字符");
  }
  if (!fullText.trim()) {
    throw materialError("MATERIAL_TEXT_EMPTY", "TXT/MD 文件没有可用文字");
  }
  return fullText;
}

function validateDocxArchive(buffer: Buffer) {
  // DOCX is a ZIP package. Inspect its central directory before Mammoth
  // decompresses XML so a small ZIP bomb cannot allocate unbounded memory.
  if (buffer.length < 22) throw materialError("MATERIAL_DOCX_INVALID", "DOCX 文件结构无效或已损坏");
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw materialError("MATERIAL_DOCX_INVALID", "DOCX 文件结构无效或已损坏");

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== entryCount || entryCount === 0xffff ||
      entryCount > MAX_DOCX_ARCHIVE_ENTRIES || centralSize === 0xffffffff || centralOffset === 0xffffffff ||
      centralOffset + centralSize > eocdOffset) {
    throw materialError("MATERIAL_DOCX_INVALID", "DOCX 文件结构无效或包含不支持的 ZIP64 格式");
  }

  let offset = centralOffset;
  let totalUncompressedBytes = 0;
  let hasDocumentXml = false;
  let hasContentTypes = false;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw materialError("MATERIAL_DOCX_INVALID", "DOCX 文件结构无效或已损坏");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const end = offset + 46 + fileNameLength + extraLength + commentLength;
    if (end > buffer.length || (flags & 1) !== 0 || uncompressedSize === 0xffffffff) {
      throw materialError("MATERIAL_DOCX_INVALID", "DOCX 文件结构无效、加密或包含不支持的 ZIP64 格式");
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw materialError("MATERIAL_DOCX_EXPANSION_LIMIT", "DOCX 解压后文件体积过大，无法安全读取");
    }
    const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    if (name === "word/document.xml") hasDocumentXml = true;
    if (name === "[Content_Types].xml") hasContentTypes = true;
    offset = end;
  }
  if (!hasDocumentXml || !hasContentTypes) throw materialError("MATERIAL_DOCX_INVALID", "文件不是有效的 DOCX 文档");
}

function normalizeExtractedDocumentText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function assertExtractedDocumentText(text: string) {
  if (!text.trim()) throw materialError("MATERIAL_DOCUMENT_NO_TEXT", "文档中没有可提取的文字；扫描件暂不支持 OCR，可改用 TXT/MD 上传文字");
  const actual = countArticleCharacters(text);
  if (actual > MAX_EXTRACTED_DOCUMENT_CHARACTERS) {
    throw new AppError({
      code: "MATERIAL_DOCUMENT_TEXT_TOO_LONG",
      message: `文档提取文字不能超过 ${MAX_EXTRACTED_DOCUMENT_CHARACTERS} 字`,
      statusCode: 422,
      details: { field: "documentText", actual, max: MAX_EXTRACTED_DOCUMENT_CHARACTERS },
    });
  }
}

export async function extractTextMaterial(buffer: Buffer, fileName: string, declaredMimeType: string) {
  const mimeType = textMaterialMimeType(fileName, declaredMimeType);
  const maxBytes = textMaterialMaxBytes(fileName, declaredMimeType);
  if (buffer.byteLength > maxBytes) {
    const message = mimeType.startsWith("text/") ? "TXT/MD 文件不能超过 2 MB" : "PDF/DOCX 文件不能超过 10 MB";
    throw materialError("MATERIAL_FILE_TOO_LARGE", message);
  }

  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return { mimeType, fullText: await decodeTextMaterial(buffer) };
  }

  const detected = await fileTypeFromBuffer(buffer);
  // DOCX is a ZIP container; the OOXML package structure below establishes
  // that it is DOCX rather than accepting an arbitrary ZIP as a document.
  const detectedMimeMatches = mimeType === "application/pdf"
    ? detected?.mime === "application/pdf"
    : detected?.mime === "application/zip";
  if (!detectedMimeMatches) {
    throw materialError("MATERIAL_TYPE_UNSUPPORTED", "文件实际内容与扩展名或文件类型不一致");
  }

  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const info = await parser.getInfo();
      if (info.total > MAX_PDF_PAGES) {
        throw materialError("MATERIAL_PDF_PAGE_LIMIT", `PDF 文件不能超过 ${MAX_PDF_PAGES} 页`);
      }
      const result = await parser.getText({ pageJoiner: "\n" });
      const fullText = normalizeExtractedDocumentText(result.text);
      assertExtractedDocumentText(fullText);
      return { mimeType, fullText };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && /password|encrypted|加密|口令/iu.test(`${error.name} ${error.message}`)) {
        throw materialError("MATERIAL_PDF_ENCRYPTED", "PDF 已加密，请解除密码保护后重新上传");
      }
      throw materialError("MATERIAL_PDF_PARSE_FAILED", "PDF 文件无法读取，请确认文件未损坏且包含可复制的文字，或改用 TXT/MD");
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  validateDocxArchive(buffer);
  try {
    const result = await mammoth.extractRawText({ buffer });
    const fullText = normalizeExtractedDocumentText(result.value);
    assertExtractedDocumentText(fullText);
    return { mimeType, fullText };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw materialError("MATERIAL_DOCX_PARSE_FAILED", "DOCX 文件无法读取，请确认文档未损坏，或改用 TXT/MD");
  }
}

export function reviewEntireText(fileName: string, fullText: string, safetyRules: SafetyRuleEngine) {
  const filenameReview = safetyRules.scan({ title: fileName, body: "" });
  const fileNameRisk = filenameReview.riskItems.find((risk) => risk.severity === "medium" || risk.severity === "high");
  if (fileNameRisk) return { approved: false, reason: fileNameRisk.reason };

  // Scan the entire document in overlapping windows. The overlap covers the
  // longest cross-boundary expression in the current deterministic rule set.
  const step = REVIEW_CHUNK_LENGTH - REVIEW_OVERLAP;
  for (let start = 0; start < fullText.length; start += step) {
    const chunk = fullText.slice(start, start + REVIEW_CHUNK_LENGTH);
    const review = safetyRules.scan({ title: "", body: chunk });
    const blockingRisk = review.riskItems.find((risk) => risk.severity === "medium" || risk.severity === "high");
    if (blockingRisk) return { approved: false, reason: blockingRisk.reason };
  }
  return { approved: true, reason: null };
}
