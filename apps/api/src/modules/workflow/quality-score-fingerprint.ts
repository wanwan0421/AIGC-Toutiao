import { createHash } from "node:crypto";

// Increment this when the quality scoring instructions or interpretation changes.
const QUALITY_SCORING_REVISION = 1;

export function qualityScoreContentHash(title: string, body: string) {
  return createHash("sha256")
    .update(JSON.stringify({ revision: QUALITY_SCORING_REVISION, title, body }))
    .digest("hex");
}
