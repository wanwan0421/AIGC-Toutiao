import type { AiJobSnapshot } from "@aicp/shared";

export function aiJobContentId(job: Pick<AiJobSnapshot, "contentId" | "input">) {
  const payloadContentId = typeof job.input?.contentId === "string" ? job.input.contentId : undefined;
  return job.contentId ?? payloadContentId;
}

export function isAiJobInEditorScope(
  currentContentId: string | null | undefined,
  job: Pick<AiJobSnapshot, "contentId" | "input">,
) {
  const targetContentId = aiJobContentId(job);
  return !targetContentId || currentContentId === targetContentId;
}
