import { afterEach, describe, expect, it } from "vitest";
import {
  sanitizeRichTextHtml,
  sanitizeRichTextJson,
  sanitizeRichTextPayload,
} from "./rich-text-sanitizer";

describe("rich-text-sanitizer", () => {
  const previousAllowedOrigins = process.env.RICH_TEXT_IMAGE_ALLOWED_ORIGINS;

  afterEach(() => {
    process.env.RICH_TEXT_IMAGE_ALLOWED_ORIGINS = previousAllowedOrigins;
  });

  it("keeps supported formatting and removes executable HTML", () => {
    const sanitized = sanitizeRichTextHtml(`
      <h2 style="text-align: center; color: red" onclick="alert(1)">标题</h2>
      <p>安全<strong>正文</strong><script>alert(1)</script></p>
      <a href="javascript:alert(1)" target="_blank">坏链接</a>
      <a href="https://example.com/article" target="_blank" onclick="alert(1)">安全链接</a>
      <img src="/api/uploads/images/safe.webp" alt="封面" onerror="alert(1)">
      <img src="https://evil.example/tracker.png" alt="跟踪图">
      <iframe src="https://evil.example"></iframe>
    `)!;

    expect(sanitized).toContain('<h2 style="text-align:center">标题</h2>');
    expect(sanitized).toContain("<strong>正文</strong>");
    expect(sanitized).toContain('<a target="_blank" rel="noopener noreferrer nofollow">坏链接</a>');
    expect(sanitized).toContain('href="https://example.com/article"');
    expect(sanitized).toContain('src="/api/uploads/images/safe.webp"');
    expect(sanitized).not.toContain("script");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("tracker.png");
    expect(sanitized).not.toContain("iframe");
    expect(sanitized).not.toContain("color:red");
  });

  it("allows explicitly configured image origins only", () => {
    process.env.RICH_TEXT_IMAGE_ALLOWED_ORIGINS = "https://cdn.example.com";
    const sanitized = sanitizeRichTextHtml(`
      <img src="https://cdn.example.com/a.webp" alt="可信">
      <img src="https://other.example/a.webp" alt="不可信">
    `)!;

    expect(sanitized).toContain('src="https://cdn.example.com/a.webp"');
    expect(sanitized).not.toContain("other.example");
  });

  it("rebuilds Tiptap JSON from node, mark, attribute, and URL allowlists", () => {
    const sanitized = sanitizeRichTextJson({
      type: "doc",
      evil: "discarded",
      content: [
        {
          type: "heading",
          attrs: { level: 2, textAlign: "center", onclick: "alert(1)" },
          content: [{ type: "text", text: "标题" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "正文",
              marks: [
                { type: "bold", attrs: { onclick: "alert(1)" } },
                { type: "link", attrs: { href: "javascript:alert(1)" } },
                { type: "unknown", attrs: { payload: "x" } },
              ],
            },
          ],
        },
        { type: "image", attrs: { src: "/api/uploads/images/safe.webp", alt: "配图", onerror: "alert(1)" } },
        { type: "image", attrs: { src: "data:image/svg+xml,<svg onload=alert(1)>" } },
        { type: "script", attrs: { src: "https://evil.example/x.js" } },
      ],
    });

    expect(sanitized).toEqual({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, textAlign: "center" },
          content: [{ type: "text", text: "标题" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "正文", marks: [{ type: "bold" }] }],
        },
        { type: "image", attrs: { src: "/api/uploads/images/safe.webp", alt: "配图" } },
      ],
    });
  });

  it("sanitizes rich text embedded in draft payloads without dropping editor metadata", () => {
    const sanitized = sanitizeRichTextPayload({
      html: '<p onclick="alert(1)">草稿</p>',
      json: { type: "doc", content: [{ type: "script" }] },
      tags: ["安全"],
      coverMode: "single",
    });

    expect(sanitized).toEqual({
      html: "<p>草稿</p>",
      json: { type: "doc", content: [] },
      tags: ["安全"],
      coverMode: "single",
    });
  });

  it("rejects non-document JSON roots", () => {
    expect(sanitizeRichTextJson({ type: "paragraph", content: [] })).toBeNull();
  });
});
