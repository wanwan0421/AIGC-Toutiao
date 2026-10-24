import { z } from "zod";
import { ARTICLE_TITLE_MAX_LENGTH, countArticleCharacters } from "@aicp/shared";
const text = z.string().trim().min(1);
const articleTitle = text.refine((value) => countArticleCharacters(value) <= ARTICLE_TITLE_MAX_LENGTH, {
  message: `标题不得超过 ${ARTICLE_TITLE_MAX_LENGTH} 个可见字符`,
});
export const titleGenerateSchema = z.object({ candidates: z.array(z.object({ title: articleTitle, reason: text }).strict()).min(1).max(3) }).strict();
export const selectionRewriteSchema = z.object({ replacement: text }).strict();
export const qualityScoreSchema = z.object({
  total: z.number().int().min(0).max(100),
  dimensions: z.object({ structure: z.number().int().min(0).max(20), clarity: z.number().int().min(0).max(20), value: z.number().int().min(0).max(20), attraction: z.number().int().min(0).max(20), compliance: z.number().int().min(0).max(20) }).strict(),
  reason: text,
}).strict();
export const complianceRewriteSchema = z.object({
  title: articleTitle, body: text, reasons: z.array(text).min(1),
  replacements: z.array(z.object({ riskItemId: text, original: text, replacement: text, reason: text }).strict()),
}).strict();
export const imageModerationSchema = z.object({
  pass: z.boolean(), level: z.enum(["low", "medium", "high"]), reason: z.string().max(500),
  types: z.array(z.enum(["pornography", "gambling", "drug", "sensitive", "violence", "fraud", "none"])).max(8),
}).strict();
export const requirementAnalysisSchema = z.object({
  needsClarification: z.boolean(), clarificationQuestion: z.string().max(200), theme: z.string().max(100), audience: z.string().max(200), style: z.string().max(300), viewpoint: z.string().max(300), materialNotes: z.string().max(1600), sourceSummary: z.string().max(800),
}).strict();
const titleCandidate = z.object({ title: articleTitle, reason: z.string().max(100) }).strict();
const outlineItem = z.object({ heading: text.max(60), summary: z.string().max(160) }).strict();
const imagePrompt = z.object({ slotId: z.string().max(80).nullable(), position: text.max(80), prompt: text.max(900) }).strict();
const titleCandidates = z.array(titleCandidate).max(3);
const articleBody = text.max(6000);
const tags = z.array(text.max(40)).max(10);
const outline = z.array(outlineItem).max(6);
const imagePrompts = z.array(imagePrompt).max(3);
const coverPrompt = text.max(900);
export const articleDraftSchema = z.object({ title: articleTitle, titleCandidates, bodyMarkdown: articleBody, tags, outline }).strict();
export const visualPlanSchema = z.object({ bodyMarkdown: articleBody, coverSuggestion: coverPrompt, imagePrompts }).strict();
export const directGenerateSchema = z.object({ title: articleTitle, titleCandidates, bodyMarkdown: articleBody, tags, coverSuggestion: coverPrompt, imagePrompts, outline }).strict();
export const skillRouterSchema = z.object({
  action: z.enum(["chat", "run_skill", "edit_current_content", "ask_clarification"]),
  skillKey: z.enum(["content-production-line", "content-safety-reviewer"]).nullable(),
  confidence: z.number().min(0).max(1), message: z.string().nullable(),
  input: z.object({ theme: z.string().nullable(), audience: z.string().nullable(), style: z.string().nullable(), viewpoint: z.string().nullable(), materialNotes: z.string().nullable() }).strict(),
}).strict();
