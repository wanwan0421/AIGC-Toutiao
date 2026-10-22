import { describe, expect, it } from "vitest";
import { validateArticleText } from "./article-length-policy";

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("validateArticleText", () => {
  it("accepts exactly 25 title and 1000 body graphemes and rejects the next character", () => {
    expect(validateArticleText({ title: "标".repeat(25), body: "文".repeat(1000) }).body).toHaveLength(1000);
    expect(() => validateArticleText({ title: "标".repeat(26), body: "文" })).toThrowError(
      expect.objectContaining({ code: "ARTICLE_LENGTH_EXCEEDED", statusCode: 422 })
    );
    expect(() => validateArticleText({ title: "标", body: "文".repeat(1001) })).toThrowError(
      expect.objectContaining({ code: "ARTICLE_LENGTH_EXCEEDED", statusCode: 422 })
    );
  });

  it("counts punctuation, visible spaces, line breaks and emoji consistently", () => {
    expect(validateArticleText({ title: "😀".repeat(25), body: "，".repeat(998) + " \n" }).body).toBe("，".repeat(998) + " \n");
    expect(() => validateArticleText({ title: "😀".repeat(25), body: "，".repeat(999) + " \n" })).toThrowError(
      expect.objectContaining({ code: "ARTICLE_LENGTH_EXCEEDED" })
    );
  });

  it("counts paragraph boundaries and repeated hard breaks in HTML and Tiptap JSON", () => {
    const json = { type: "doc", content: [paragraph("a"), paragraph("b")] };
    expect(validateArticleText({ title: "t", body: "a\n\nb", bodyHtml: "<p>a</p><p>b</p>", bodyJson: json }).body).toBe("a\n\nb");

    const text = "字".repeat(998);
    const richJson = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }, { type: "hardBreak" }, { type: "hardBreak" }] }],
    };
    expect(validateArticleText({ title: "t", body: `${text}\n\n`, bodyHtml: `<p>${text}<br><br></p>`, bodyJson: richJson }).body).toBe(`${text}\n\n`);
    const tooLong = "字".repeat(999);
    expect(() => validateArticleText({ title: "t", body: tooLong, bodyHtml: `<p>${tooLong}<br><br></p>` })).toThrowError(
      expect.objectContaining({ code: "ARTICLE_LENGTH_EXCEEDED" })
    );
    expect(() => validateArticleText({ title: "t", body: tooLong, bodyJson: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: tooLong }, { type: "hardBreak" }, { type: "hardBreak" }] }],
    } })).toThrowError(expect.objectContaining({ code: "ARTICLE_LENGTH_EXCEEDED" }));
  });

  it("uses visible text instead of HTML markup or attributes", () => {
    expect(validateArticleText({ title: "t", bodyHtml: "<p>A&amp;B</p>" }).body).toBe("A&B");
    expect(validateArticleText({ title: "t", bodyHtml: "<h4>甲&#38;乙</h4>" }).body).toBe("甲&乙");
    expect(validateArticleText({ title: "t", bodyHtml: '<p>A<img src="/api/uploads/x" alt="long invisible text">B</p>' }).body).toBe("AB");
  });

  it("rejects a shorter plain body that disagrees with rich text", () => {
    expect(() => validateArticleText({ title: "t", body: "short", bodyHtml: "<p>different</p>" })).toThrowError(
      expect.objectContaining({ code: "ARTICLE_TEXT_MISMATCH", statusCode: 422 })
    );
    expect(() => validateArticleText({ title: "t", body: "x", bodyHtml: "<p>x<br></p>" })).toThrowError(
      expect.objectContaining({ code: "ARTICLE_TEXT_MISMATCH", statusCode: 422 })
    );
  });

  it("handles empty paragraphs and list items without losing visible list text", () => {
    const empty = { type: "paragraph" };
    expect(validateArticleText({
      title: "t", body: "\n\n内容\n\n", bodyHtml: "<p></p><p>内容</p><p></p>",
      bodyJson: { type: "doc", content: [empty, paragraph("内容"), empty] },
    }).body).toBe("\n\n内容\n\n");

    expect(validateArticleText({
      title: "t", body: "一\n\n二", bodyHtml: "<ul><li><p>一</p></li><li><p>二</p></li></ul>",
      bodyJson: { type: "doc", content: [{
        type: "bulletList", content: [
          { type: "listItem", content: [paragraph("一")] },
          { type: "listItem", content: [paragraph("二")] },
        ],
      }] },
    }).body).toBe("一\n\n二");

    expect(validateArticleText({
      title: "t", body: "甲\n\n乙\n\n丙\n\n丁",
      bodyHtml: "<table><tbody><tr><th><p>甲</p></th><th><p>乙</p></th></tr><tr><td><p>丙</p></td><td><p>丁</p></td></tr></tbody></table>",
      bodyJson: { type: "doc", content: [{ type: "table", content: [
        { type: "tableRow", content: [
          { type: "tableHeader", content: [paragraph("甲")] },
          { type: "tableHeader", content: [paragraph("乙")] },
        ] },
        { type: "tableRow", content: [
          { type: "tableCell", content: [paragraph("丙")] },
          { type: "tableCell", content: [paragraph("丁")] },
        ] },
      ] }] },
    }).body).toBe("甲\n\n乙\n\n丙\n\n丁");
  });
});
