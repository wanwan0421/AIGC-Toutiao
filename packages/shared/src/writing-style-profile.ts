import { z } from "zod";

/** Describes a writing method, never source-article facts or executable tools. */
export const WritingStyleMethodSchema = z.object({
  structure: z.string().max(1200),
  opening: z.string().max(600),
  transitions: z.string().max(600),
  ending: z.string().max(600),
  tone: z.string().max(600),
  viewpoint: z.string().max(600),
  diction: z.string().max(600),
}).strict();

export const WritingStyleTopicSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
  sampleCount: z.number().int().min(2),
  method: WritingStyleMethodSchema,
}).strict();

/** A complete immutable-version profile: common method plus optional topics. */
export const WritingStyleProfileSchema = z.object({
  schemaVersion: z.literal(1),
  summary: z.string().trim().min(1).max(1200),
  common: WritingStyleMethodSchema,
  topics: z.array(WritingStyleTopicSchema).max(20),
  authorLockedPaths: z.array(z.string().trim().min(1).max(160)).max(100),
}).strict().superRefine((profile, context) => {
  const seen = new Set<string>();
  for (const [index, topic] of profile.topics.entries()) {
    if (seen.has(topic.key)) {
      context.addIssue({
        code: "custom",
        message: "Duplicate topic key",
        path: ["topics", index, "key"],
      });
    }
    seen.add(topic.key);
  }
});

export const WritingStyleSourceManifestSchema = z.array(z.object({
  contentId: z.string().min(1),
  contentHash: z.string().min(1),
}).strict()).min(1).superRefine((manifest, context) => {
  const seen = new Set<string>();
  for (const [index, source] of manifest.entries()) {
    if (seen.has(source.contentId)) {
      context.addIssue({
        code: "custom",
        message: "Duplicate source content ID",
        path: [index, "contentId"],
      });
    }
    seen.add(source.contentId);
  }
});

export type WritingStyleMethod = z.infer<typeof WritingStyleMethodSchema>;
export type WritingStyleProfile = z.infer<typeof WritingStyleProfileSchema>;
export type WritingStyleSourceManifest = z.infer<typeof WritingStyleSourceManifestSchema>;

export type WritingSkillStatus =
  | "uncreated"
  | "building"
  | "awaiting_confirmation"
  | "build_failed"
  | "ready"
  | "updating"
  | "paused";
