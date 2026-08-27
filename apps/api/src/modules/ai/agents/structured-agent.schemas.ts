import { z } from "zod";
const text = z.string().trim().min(1);
export const titleGenerateSchema = z.object({ candidates: z.array(z.object({ title: text, reason: text }).strict()).min(1).max(3) }).strict();
export const selectionRewriteSchema = z.object({ replacement: text }).strict();
export const qualityScoreSchema = z.object({
  total: z.number().int().min(0).max(100),
  dimensions: z.object({ structure: z.number().int().min(0).max(20), clarity: z.number().int().min(0).max(20), value: z.number().int().min(0).max(20), attraction: z.number().int().min(0).max(20), compliance: z.number().int().min(0).max(20) }).strict(),
  reason: text,
}).strict();
export const complianceRewriteSchema = z.object({
  title: text, body: text, reasons: z.array(text).min(1),
  replacements: z.array(z.object({ riskItemId: text, original: text, replacement: text, reason: text }).strict()),
}).strict();
export const imageModerationSchema = z.object({
  pass: z.boolean(), level: z.enum(["low", "medium", "high"]), reason: z.string().max(500),
  types: z.array(z.enum(["pornography", "gambling", "drug", "sensitive", "violence", "fraud", "none"])).max(8),
}).strict();
export const requirementAnalysisSchema = z.object({
  needsClarification: z.boolean(), clarificationQuestion: z.string(), theme: z.string(), audience: z.string(), style: z.string(), viewpoint: z.string(), materialNotes: z.string(), sourceSummary: z.string(),
}).strict();
const titleCandidate = z.object({ title: text, reason: z.string() }).strict();
const outlineItem = z.object({ heading: text, summary: z.string() }).strict();
const imagePrompt = z.object({ slotId: z.string().nullable(), position: text, prompt: text }).strict();
export const articleDraftSchema = z.object({ title: text, titleCandidates: z.array(titleCandidate), bodyMarkdown: text, tags: z.array(text), outline: z.array(outlineItem) }).strict();
export const visualPlanSchema = z.object({ bodyMarkdown: text, coverSuggestion: text, imagePrompts: z.array(imagePrompt) }).strict();
export const directGenerateSchema = z.object({ title: text, titleCandidates: z.array(titleCandidate), bodyMarkdown: text, tags: z.array(text), coverSuggestion: text, imagePrompts: z.array(imagePrompt), outline: z.array(outlineItem) }).strict();
export const skillRouterSchema = z.object({
  action: z.enum(["chat", "run_skill", "edit_current_content", "ask_clarification"]),
  skillKey: z.enum(["content-production-line", "content-safety-reviewer"]).nullable(),
  confidence: z.number().min(0).max(1), message: z.string().nullable(),
  input: z.object({ theme: z.string().nullable(), audience: z.string().nullable(), style: z.string().nullable(), viewpoint: z.string().nullable(), materialNotes: z.string().nullable() }).strict(),
}).strict();
