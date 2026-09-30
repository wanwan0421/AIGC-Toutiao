import { describe, expect, it } from "vitest";
import { validateBusinessQuality } from "./business-quality.validator";

describe("validateBusinessQuality", () => {
  it("allows normal rich-text node arrays longer than ten items", () => {
    const document = {
      payload: {
        json: {
          type: "doc",
          content: Array.from({ length: 30 }, (_, index) => ({
            type: "paragraph",
            content: [{ type: "text", text: `paragraph ${index}` }],
          })),
        },
      },
    };
    expect(validateBusinessQuality(document)).toBeNull();
  });

  it("keeps material and image business limits", () => {
    expect(validateBusinessQuality({ payload: { assetIds: Array.from({ length: 11 }, (_, index) => String(index)) } }))
      .toEqual({ path: "body.payload.assetIds", message: "array exceeds 10 items" });
    expect(validateBusinessQuality({ payload: { generatedImageCandidates: Array.from({ length: 6 }, () => ({})) } }))
      .toEqual({ path: "body.payload.generatedImageCandidates", message: "array exceeds 5 items" });
  });

  it("allows the nested nodes used by rich-text lists in content commits", () => {
    const nestedList = {
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "nested rich text" }],
          }],
        }],
      }],
    };

    expect(validateBusinessQuality({ content: { bodyJson: nestedList } })).toBeNull();
    expect(validateBusinessQuality({ content: { payload: { json: nestedList } } })).toBeNull();
  });

  it("keeps the generic nesting limit outside rich-text fields", () => {
    let value: unknown = "leaf";
    for (let index = 0; index < 10; index += 1) value = { child: value };

    expect(validateBusinessQuality({ metadata: value })).toEqual(expect.objectContaining({
      message: "object nesting exceeds 8 levels",
    }));
  });
});
