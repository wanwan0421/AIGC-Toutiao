import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { AiJobType } from "@aicp/shared";
import { z } from "zod";

const text = (max = 20_000) => z.string().trim().max(max);
const base = z.object({
  contentId: text(128).optional(),
  conversationId: text(128).optional(),
  assistantMessageId: text(128).optional(),
}).strict();

const schemas: Partial<Record<AiJobType, z.ZodTypeAny>> = {
  [AiJobType.CreativeChat]: base.extend({
    message: text().min(1), currentTitle: text(100).optional(), currentBody: text().optional(), selectedText: text().optional(),
  }).strict(),
  [AiJobType.CreativeDirectGenerate]: base.extend({
    theme: text().min(1), audience: text(500).optional(), style: text(500).optional(), viewpoint: text(2_000).optional(),
    materialNotes: text().optional(), assets: z.array(text(128)).max(10).optional(), source: z.enum(["button", "conversation"]).optional(),
  }).strict(),
  [AiJobType.CreativeImageGenerate]: base.extend({ position: text(100).optional(), prompt: text().min(1) }).strict(),
  [AiJobType.ComplianceRewrite]: base.extend({ title: text(100).optional(), body: text().optional(), reasons: z.array(text(500)).max(10).optional() }).strict(),
  [AiJobType.ContentSubmitReview]: base,
  [AiJobType.ContentApprove]: base,
  [AiJobType.ModerationContentRun]: base,
};

@Injectable()
export class AiJobPayloadValidator {
  parse(type: `${AiJobType}`, value: unknown) {
    const generic = z.record(z.string(), z.unknown()).refine((record) => Object.keys(record).length <= 50, "too many payload fields");
    const result = (schemas[type as AiJobType] ?? generic).safeParse(value);
    if (!result.success) {
      throw new UnprocessableEntityException({
        message: "AI job payload validation failed",
        details: { fields: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
      });
    }
    return result.data as Record<string, unknown>;
  }
}
