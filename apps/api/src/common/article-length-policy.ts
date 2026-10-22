import { ARTICLE_BODY_MAX_LENGTH, ARTICLE_TITLE_MAX_LENGTH, countArticleCharacters } from "@aicp/shared";
import sanitizeHtml from "sanitize-html";
import { decodeHTML } from "entities";
import { AppError } from "./app-error";
import { sanitizeRichText, type SanitizedRichText } from "./rich-text-sanitizer";

type ArticleTextInput = {
  title: string;
  body?: string | null;
  bodyHtml?: string | null;
  bodyJson?: Record<string, unknown> | null;
};

export type ValidatedArticleText = {
  title: string;
  body: string;
  richText: SanitizedRichText;
};

/** Check all representations after sanitizing; a shorter body cannot hide longer rich text. */
export function validateArticleText(input: ArticleTextInput): ValidatedArticleText {
  const richText = sanitizeRichText({ html: input.bodyHtml, json: input.bodyJson });
  const representations: Array<{ name: string; text: string }> = [];
  if (input.body !== undefined && input.body !== null) representations.push({ name: "body", text: input.body });
  if (richText.html !== undefined && richText.html !== null) {
    representations.push({ name: "bodyHtml", text: visibleTextFromHtml(richText.html) });
  }
  if (richText.json !== undefined && richText.json !== null) {
    representations.push({ name: "bodyJson", text: visibleTextFromJson(richText.json) });
  }

  const titleCount = countArticleCharacters(input.title);
  const bodyCount = Math.max(0, ...representations.map((item) => countArticleCharacters(item.text)));
  if (titleCount > ARTICLE_TITLE_MAX_LENGTH || bodyCount > ARTICLE_BODY_MAX_LENGTH) {
    throw new AppError({
      code: "ARTICLE_LENGTH_EXCEEDED",
      message: `标题最多 ${ARTICLE_TITLE_MAX_LENGTH} 字，正文最多 ${ARTICLE_BODY_MAX_LENGTH} 字`,
      statusCode: 422,
      details: {
        title: { actual: titleCount, max: ARTICLE_TITLE_MAX_LENGTH },
        body: { actual: bodyCount, max: ARTICLE_BODY_MAX_LENGTH },
      },
    });
  }

  const canonical = representations[0];
  for (const representation of representations.slice(1)) {
    if (comparableText(representation.text) !== comparableText(canonical.text)) {
      throw new AppError({
        code: "ARTICLE_TEXT_MISMATCH",
        message: "正文与富文本显示内容不一致，请刷新后重试",
        statusCode: 422,
        details: { fields: [canonical.name, representation.name] },
      });
    }
  }

  return {
    title: input.title,
    body: input.body ?? (richText.json != null ? visibleTextFromJson(richText.json) : visibleTextFromHtml(richText.html ?? "")),
    richText,
  };
}

export function isArticleLengthExceeded(input: ArticleTextInput): boolean {
  const richText = sanitizeRichText({ html: input.bodyHtml, json: input.bodyJson });
  const texts = [
    input.body ?? "",
    richText.html == null ? "" : visibleTextFromHtml(richText.html),
    richText.json == null ? "" : visibleTextFromJson(richText.json),
  ];
  return countArticleCharacters(input.title) > ARTICLE_TITLE_MAX_LENGTH ||
    texts.some((text) => countArticleCharacters(text) > ARTICLE_BODY_MAX_LENGTH);
}

function comparableText(text: string) {
  return text.normalize("NFC").replace(/\r\n?/g, "\n");
}

function visibleTextFromHtml(html: string) {
  // Mark block boundaries separately from explicit <br> nodes. Collapsing all
  // newlines would undercount repeated hard breaks supplied by the author.
  const [blockMarker, breakMarker] = unusedMarkers(html);
  const withSeparators = html
    .replace(/<br\s*\/?\s*>/gi, breakMarker)
    .replace(/<\/(?:p|h[1-6]|pre|figcaption)>/gi, `$&${blockMarker}`);
  const parts: string[] = [];
  sanitizeHtml(withSeparators, {
    allowedTags: [],
    allowedAttributes: {},
    textFilter: (text) => {
      parts.push(text);
      return text;
    },
  });
  return joinVisibleBlocks(decodeHTML(parts.join("")), blockMarker, breakMarker);
}

function visibleTextFromJson(value: unknown): string {
  const blocks: string[] = [];
  const inlineText = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const item = node as Record<string, unknown>;
    if (item.type === "text") return typeof item.text === "string" ? item.text : "";
    if (item.type === "hardBreak") return "\n";
    return Array.isArray(item.content) ? item.content.map(inlineText).join("") : "";
  };
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    if (item.type === "paragraph" || item.type === "heading" || item.type === "codeBlock") {
      blocks.push(inlineText(item));
      return;
    }
    if (Array.isArray(item.content)) item.content.forEach(visit);
  };
  visit(value);
  return blocks.join("\n\n");
}

function unusedMarkers(text: string): [string, string] {
  const markers: string[] = [];
  for (let code = 0xe000; code <= 0xf8ff && markers.length < 2; code++) {
    const marker = String.fromCharCode(code);
    if (!text.includes(marker)) markers.push(marker);
  }
  if (markers.length !== 2) throw new Error("No available article separator markers");
  return [markers[0], markers[1]];
}

function joinVisibleBlocks(text: string, blockMarker: string, breakMarker: string) {
  const blocks = text.split(blockMarker);
  if (text.endsWith(blockMarker)) blocks.pop();
  return blocks.join("\n\n").replaceAll(breakMarker, "\n");
}
