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
});
