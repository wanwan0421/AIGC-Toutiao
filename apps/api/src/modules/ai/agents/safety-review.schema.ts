import { z } from "zod";

const riskTypeSchema = z.enum([
  "pornography",
  "gambling",
  "drug",
  "sensitive",
  "vulgar",
  "privacy",
  "illegal",
  "fraud",
  "minor",
]);

const scoreSchema = z.number().min(0).max(1);

export const safetyReviewOutputSchema = z
  .object({
    passed: z.boolean(),
    riskLevel: z.enum(["low", "medium", "high"]),
    riskTypes: z.array(z.union([riskTypeSchema, z.literal("none")])).min(1),
    categoryScores: z
      .object({
        pornography: scoreSchema,
        gambling: scoreSchema,
        drug: scoreSchema,
        sensitive: scoreSchema,
        vulgar: scoreSchema,
        privacy: scoreSchema,
        illegal: scoreSchema,
        fraud: scoreSchema,
        minor: scoreSchema,
      })
      .strict(),
    riskItems: z.array(
      z
        .object({
          id: z.string().min(1),
          type: riskTypeSchema,
          severity: z.enum(["low", "medium", "high"]),
          confidence: scoreSchema,
          evidence: z.string().trim().min(1),
          reason: z.string().trim().min(1),
          source: z.literal("llm"),
          field: z.enum(["title", "body"]),
          startOffset: z.number().int().nonnegative().nullable(),
          endOffset: z.number().int().nonnegative().nullable(),
          suggestion: z.string().trim().min(1).nullable(),
        })
        .strict()
        .superRefine((item, context) => {
          if ((item.startOffset === null) !== (item.endOffset === null)) {
            context.addIssue({ code: "custom", message: "startOffset and endOffset must be provided together" });
          }
          if (item.startOffset !== null && item.endOffset !== null && item.endOffset < item.startOffset) {
            context.addIssue({ code: "custom", message: "endOffset must be greater than or equal to startOffset" });
          }
        })
    ),
    reasons: z.array(z.string().trim().min(1)).min(1),
    rewriteAvailable: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    const blockingItems = result.riskItems.filter((item) => item.severity === "medium" || item.severity === "high");
    if (result.passed) {
      if (result.riskLevel !== "low" || result.riskTypes.length !== 1 || result.riskTypes[0] !== "none" || blockingItems.length) {
        context.addIssue({ code: "custom", message: "passed results must be low risk with only the none type and no blocking items" });
      }
      if (result.rewriteAvailable) {
        context.addIssue({ code: "custom", message: "passed results cannot offer a compliance rewrite" });
      }
      return;
    }

    if (result.riskLevel === "low" || result.riskTypes.every((type) => type === "none")) {
      context.addIssue({ code: "custom", message: "blocked results must have a medium/high level and a concrete risk type" });
    }
  });

export type SafetyReviewOutput = z.infer<typeof safetyReviewOutputSchema>;

const generatedJsonSchema = z.toJSONSchema(safetyReviewOutputSchema, {
  target: "draft-2020-12",
}) as Record<string, unknown>;

delete generatedJsonSchema.$schema;
export const safetyReviewJsonSchema = generatedJsonSchema;
