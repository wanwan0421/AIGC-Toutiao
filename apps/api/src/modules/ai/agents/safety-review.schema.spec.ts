import { describe, expect, it } from "vitest";
import { safetyReviewJsonSchema, safetyReviewOutputSchema } from "./safety-review.schema";

const passingResult = {
  passed: true,
  riskLevel: "low",
  riskTypes: ["none"],
  categoryScores: {
    pornography: 0,
    gambling: 0,
    drug: 0,
    sensitive: 0,
    vulgar: 0,
    privacy: 0,
    illegal: 0,
    fraud: 0,
    minor: 0,
  },
  riskItems: [],
  reasons: ["未发现明显合规风险"],
  rewriteAvailable: false,
};

describe("safetyReviewOutputSchema", () => {
  it("accepts a consistent passing result", () => {
    expect(safetyReviewOutputSchema.safeParse(passingResult).success).toBe(true);
  });

  it("rejects internally inconsistent passing results", () => {
    const parsed = safetyReviewOutputSchema.safeParse({
      ...passingResult,
      riskLevel: "medium",
      rewriteAvailable: true,
    });
    expect(parsed.success).toBe(false);
  });

  it("exports a strict native JSON Schema", () => {
    expect(safetyReviewJsonSchema.type).toBe("object");
    expect(safetyReviewJsonSchema.additionalProperties).toBe(false);
    expect(safetyReviewJsonSchema.required).toContain("riskItems");
    const properties = safetyReviewJsonSchema.properties as Record<string, Record<string, unknown>>;
    const riskItemSchema = properties.riskItems.items as Record<string, unknown>;
    expect(riskItemSchema.required).toContain("startOffset");
    expect(riskItemSchema.required).toContain("suggestion");
  });
});
