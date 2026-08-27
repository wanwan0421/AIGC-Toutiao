import sanitizeHtml from "sanitize-html";
import { getUploadPublicBase } from "../modules/storage/storage.config";

const MAX_RICH_TEXT_DEPTH = 32;
const MAX_RICH_TEXT_NODES = 5_000;

const ALLOWED_TAGS = [
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "blockquote",
  "pre",
  "code",
  "strong",
  "b",
  "em",
  "i",
  "s",
  "strike",
  "del",
  "u",
  "ul",
  "ol",
  "li",
  "hr",
  "a",
  "figure",
  "figcaption",
  "img",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
] as const;

const TEXT_ALIGN_TAGS = ["p", "h1", "h2", "h3"] as const;
const BLOCK_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "codeBlock",
  "horizontalRule",
  "image",
  "table",
]);
const INLINE_NODE_TYPES = new Set(["text", "hardBreak"]);
const CELL_NODE_TYPES = new Set([...BLOCK_NODE_TYPES]);
const MARK_TYPES = new Set(["bold", "italic", "strike", "underline", "code", "link"]);

type JsonRecord = Record<string, unknown>;
type SanitizationBudget = { nodes: number };

export type SanitizedRichText = {
  html?: string | null;
  json?: JsonRecord | null;
};

/**
 * Sanitizes cached HTML with a small allowlist matching the Tiptap extensions
 * used by the web editor. Event attributes, scripts, embeds, arbitrary styles,
 * unsafe URL schemes, and untrusted image origins are discarded.
 */
export function sanitizeRichTextHtml(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;

  return sanitizeHtml(value, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      ol: ["start"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
      ...Object.fromEntries(TEXT_ALIGN_TAGS.map((tag) => [tag, ["style"]])),
    },
    allowedStyles: {
      "*": {
        "text-align": [/^(?:left|center|right|justify)$/],
      },
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: sanitizeAnchorAttributes(attributes),
      }),
      img: (_tagName, attributes) => ({
        tagName: "img",
        attribs: sanitizeImageAttributes(attributes),
      }),
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  }).trim();
}

/**
 * Sanitizes Tiptap/ProseMirror JSON by rebuilding it from an explicit node,
 * mark, attribute, and parent-child allowlist. Unknown fields never survive.
 */
export function sanitizeRichTextJson(value: JsonRecord | null | undefined): JsonRecord | null | undefined {
  if (value === undefined || value === null) return value;
  const budget: SanitizationBudget = { nodes: 0 };
  const root = sanitizeNode(value, null, 0, budget);
  return root?.type === "doc" ? root : null;
}

export function sanitizeRichText(input: SanitizedRichText): SanitizedRichText {
  return {
    html: sanitizeRichTextHtml(input.html),
    json: sanitizeRichTextJson(input.json),
  };
}

/** Sanitizes the html/json fields embedded in an editor draft payload. */
export function sanitizeRichTextPayload(value: unknown): JsonRecord | null {
  if (!isRecord(value)) return null;
  const result: JsonRecord = {};

  for (const [key, child] of Object.entries(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
    result[key] = child;
  }

  if (Object.prototype.hasOwnProperty.call(value, "html")) {
    if (typeof value.html === "string" || value.html === null) {
      result.html = sanitizeRichTextHtml(value.html);
    } else {
      delete result.html;
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, "json")) {
    if (isRecord(value.json) || value.json === null) {
      result.json = sanitizeRichTextJson(value.json);
    } else {
      delete result.json;
    }
  }

  return result;
}

function sanitizeNode(
  value: unknown,
  parentType: string | null,
  depth: number,
  budget: SanitizationBudget
): JsonRecord | null {
  if (!isRecord(value) || depth > MAX_RICH_TEXT_DEPTH || budget.nodes >= MAX_RICH_TEXT_NODES) return null;
  const type = typeof value.type === "string" ? value.type : "";
  if (!isAllowedChild(parentType, type)) return null;
  budget.nodes += 1;

  if (type === "text") {
    if (typeof value.text !== "string") return null;
    const marks = Array.isArray(value.marks)
      ? value.marks.map(sanitizeMark).filter((mark): mark is JsonRecord => Boolean(mark))
      : [];
    return {
      type,
      text: value.text,
      ...(marks.length ? { marks } : {}),
    };
  }

  if (type === "hardBreak" || type === "horizontalRule") return { type };

  if (type === "image") {
    const attributes = isRecord(value.attrs) ? value.attrs : {};
    const src = sanitizeImageUrl(attributes.src);
    if (!src) return null;
    return {
      type,
      attrs: {
        src,
        ...(safeText(attributes.alt, 500) ? { alt: safeText(attributes.alt, 500) } : {}),
        ...(safeText(attributes.title, 500) ? { title: safeText(attributes.title, 500) } : {}),
      },
    };
  }

  const content = sanitizeChildren(value.content, type, depth, budget);
  const attrs = sanitizeNodeAttributes(type, value.attrs);
  return {
    type,
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(content.length ? { content } : type === "doc" ? { content: [] } : {}),
  };
}

function sanitizeChildren(value: unknown, parentType: string, depth: number, budget: SanitizationBudget) {
  if (!Array.isArray(value)) return [];
  return value
    .map((child) => sanitizeNode(child, parentType, depth + 1, budget))
    .filter((child): child is JsonRecord => Boolean(child));
}

function isAllowedChild(parentType: string | null, type: string) {
  if (parentType === null) return type === "doc";
  if (parentType === "doc") return BLOCK_NODE_TYPES.has(type);
  if (parentType === "paragraph" || parentType === "heading") return INLINE_NODE_TYPES.has(type);
  if (parentType === "codeBlock") return type === "text";
  if (parentType === "blockquote" || parentType === "listItem") return BLOCK_NODE_TYPES.has(type);
  if (parentType === "bulletList" || parentType === "orderedList") return type === "listItem";
  if (parentType === "table") return type === "tableRow";
  if (parentType === "tableRow") return type === "tableHeader" || type === "tableCell";
  if (parentType === "tableHeader" || parentType === "tableCell") return CELL_NODE_TYPES.has(type);
  return false;
}

function sanitizeMark(value: unknown): JsonRecord | null {
  if (!isRecord(value) || typeof value.type !== "string" || !MARK_TYPES.has(value.type)) return null;
  if (value.type !== "link") return { type: value.type };

  const attributes = isRecord(value.attrs) ? value.attrs : {};
  const href = sanitizeLinkUrl(attributes.href);
  if (!href) return null;
  const target = attributes.target === "_blank" ? "_blank" : attributes.target === "_self" ? "_self" : undefined;
  return {
    type: "link",
    attrs: {
      href,
      ...(safeText(attributes.title, 500) ? { title: safeText(attributes.title, 500) } : {}),
      ...(target ? { target } : {}),
      ...(target === "_blank" ? { rel: "noopener noreferrer nofollow" } : {}),
    },
  };
}

function sanitizeNodeAttributes(type: string, value: unknown): JsonRecord {
  const attributes = isRecord(value) ? value : {};
  if (type === "heading") {
    return {
      level: allowedInteger(attributes.level, 1, 3, 2),
      ...textAlignAttribute(attributes.textAlign),
    };
  }
  if (type === "paragraph") return textAlignAttribute(attributes.textAlign);
  if (type === "orderedList") return { start: allowedInteger(attributes.start, 1, 1_000_000, 1) };
  if (type === "codeBlock") {
    const language = safeText(attributes.language, 64);
    return language ? { language } : {};
  }
  if (type === "tableHeader" || type === "tableCell") {
    const colwidth = Array.isArray(attributes.colwidth)
      ? attributes.colwidth
          .map((item) => allowedInteger(item, 1, 4_096, 0))
          .filter((item) => item > 0)
          .slice(0, 100)
      : [];
    return {
      colspan: allowedInteger(attributes.colspan, 1, 100, 1),
      rowspan: allowedInteger(attributes.rowspan, 1, 100, 1),
      ...(colwidth.length ? { colwidth } : {}),
    };
  }
  return {};
}

function textAlignAttribute(value: unknown): JsonRecord {
  return value === "left" || value === "center" || value === "right" || value === "justify"
    ? { textAlign: value }
    : {};
}

function sanitizeAnchorAttributes(attributes: Record<string, string>) {
  const href = sanitizeLinkUrl(attributes.href);
  const target = attributes.target === "_blank" ? "_blank" : attributes.target === "_self" ? "_self" : undefined;
  return {
    ...(href ? { href } : {}),
    ...(safeText(attributes.title, 500) ? { title: safeText(attributes.title, 500) } : {}),
    ...(target ? { target } : {}),
    ...(target === "_blank" ? { rel: "noopener noreferrer nofollow" } : {}),
  };
}

function sanitizeImageAttributes(attributes: Record<string, string>) {
  const src = sanitizeImageUrl(attributes.src);
  const width = allowedInteger(attributes.width, 1, 16_384, 0);
  const height = allowedInteger(attributes.height, 1, 16_384, 0);
  return {
    ...(src ? { src } : {}),
    ...(safeText(attributes.alt, 500) ? { alt: safeText(attributes.alt, 500) } : {}),
    ...(safeText(attributes.title, 500) ? { title: safeText(attributes.title, 500) } : {}),
    ...(width ? { width: String(width) } : {}),
    ...(height ? { height: String(height) } : {}),
  };
}

function sanitizeLinkUrl(value: unknown) {
  const url = normalizedUrlText(value);
  if (!url) return null;
  if (url.startsWith("#") || (url.startsWith("/") && !url.startsWith("//"))) return url;

  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol.toLowerCase()) ? url : null;
  } catch {
    return null;
  }
}

function sanitizeImageUrl(value: unknown) {
  const url = normalizedUrlText(value);
  if (!url) return null;
  const publicBase = getUploadPublicBase();

  if (publicBase.startsWith("/") && url.startsWith(`${publicBase}/`) && !url.startsWith("//")) return url;
  if (/^\/api\/uploads\/[A-Za-z0-9%._~!$&'()+,;=:@/-]+$/.test(url)) return url;
  if (/^\/[^/]/.test(url) && configuredRelativeImagePrefixes().some((prefix) => url.startsWith(prefix))) return url;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return allowedImageOrigins().has(parsed.origin.toLowerCase()) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function configuredRelativeImagePrefixes() {
  return (process.env.RICH_TEXT_IMAGE_PATH_PREFIXES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.startsWith("/") && !item.startsWith("//"))
    .map((item) => `${item.replace(/\/+$/, "")}/`);
}

function allowedImageOrigins() {
  const origins = new Set<string>();
  const publicBase = getUploadPublicBase();
  try {
    origins.add(new URL(publicBase).origin.toLowerCase());
  } catch {
    // Relative upload bases intentionally do not add an external origin.
  }

  for (const item of (process.env.RICH_TEXT_IMAGE_ALLOWED_ORIGINS ?? "").split(",")) {
    try {
      const parsed = new URL(item.trim());
      if (parsed.protocol === "https:" || parsed.protocol === "http:") origins.add(parsed.origin.toLowerCase());
    } catch {
      // Ignore malformed configuration instead of widening the allowlist.
    }
  }
  return origins;
}

function normalizedUrlText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001F\u007F\s]/.test(normalized)) return null;
  return normalized;
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function allowedInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
