import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { AiJobStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AiJobType, type AiJobResultCommitRequest, type AiJobResultCommitResponse } from "@aicp/shared";
import { toContentDetail } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { ContentDraftPersistenceService } from "./content-draft-persistence.service";
import { WorkflowJobEventsService } from "./workflow-job-events.service";
import { toAiJobSnapshot } from "./workflow-job.mapper";

const COMMIT_TYPES = new Set<string>([AiJobType.CreativeDirectGenerate, AiJobType.CreativeImageGenerate]);

@Injectable()
export class WorkflowJobResultCommitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly persistence: ContentDraftPersistenceService,
    private readonly events: WorkflowJobEventsService
  ) {}

  async commit(userId: string, jobId: string, request: AiJobResultCommitRequest): Promise<AiJobResultCommitResponse> {
    this.validateRequest(request);
    const eventId = this.parseEventId(request.resultEventId);
    const payloadHash = this.payloadHash(request.content);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const job = await tx.aiJob.findFirst({ where: { id: jobId, userId } });
      if (!job) throw new NotFoundException("AI job not found");
      if (!COMMIT_TYPES.has(job.type)) throw new BadRequestException("AI job does not require browser result commit");

      if (job.status === AiJobStatus.succeeded) {
        if (job.appliedEventId !== eventId || job.appliedPayloadHash !== payloadHash || !job.contentId) {
          throw new ConflictException("AI job result was already committed with different content");
        }
        const content = await this.getContent(tx, job.contentId);
        return { job, content, draft: null, event: null };
      }
      if (job.status !== AiJobStatus.awaiting_commit) throw new ConflictException(`AI job cannot commit from status ${job.status}`);

      const resultEvent = await tx.aiJobEvent.findFirst({ where: { id: eventId, jobId, type: "result_ready" } });
      if (!resultEvent) throw new BadRequestException("resultEventId is not a result_ready event for this job");
      const requestedContentId = request.content.contentId ?? job.contentId ?? undefined;
      if (job.contentId && requestedContentId && job.contentId !== requestedContentId) {
        throw new ConflictException("contentId does not match AI job target");
      }

      const persisted = await this.persistence.persistInTransaction(tx, userId, {
        contentId: requestedContentId,
        title: request.content.title,
        body: request.content.body,
        bodyHtml: request.content.bodyHtml,
        bodyJson: request.content.bodyJson,
        tags: request.content.tags,
        assetIds: request.content.assetIds,
        payload: request.content.payload,
        clientHash: payloadHash,
      });
      const changed = await tx.aiJob.updateMany({
        where: { id: jobId, userId, status: AiJobStatus.awaiting_commit, appliedAt: null },
        data: {
          contentId: persisted.content.id,
          status: AiJobStatus.succeeded,
          progress: 100,
          currentStep: "已保存",
          appliedAt: new Date(),
          appliedEventId: eventId,
          appliedPayloadHash: payloadHash,
          completedAt: new Date(),
          errorMessage: null,
          errorCode: null,
          errorRetryable: false,
        },
      });
      if (changed.count === 0) throw new ConflictException("AI job result commit raced with another terminal transition");
      const updated = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      const event = await this.events.createInTransaction(tx, jobId, {
        type: "done",
        data: { job: toAiJobSnapshot(updated), result: updated.result },
      });
      return { job: updated, content: persisted.content, draft: persisted.draft, event };
    });

    if (outcome.draft) await this.persistence.cacheDraft(userId, outcome.draft);
    if (outcome.event) await this.events.notify(jobId, outcome.event);
    return { job: toAiJobSnapshot(outcome.job), content: toContentDetail(outcome.content) };
  }

  private getContent(tx: Prisma.TransactionClient, contentId: string) {
    return tx.content.findUniqueOrThrow({
      where: { id: contentId },
      include: {
        author: true,
        assets: { include: { asset: true }, orderBy: { sortOrder: "asc" } },
        _count: { select: { comments: true } },
      },
    });
  }

  private parseEventId(value: string) {
    if (!/^\d+$/.test(value.trim())) throw new BadRequestException("invalid resultEventId");
    return BigInt(value);
  }

  private validateRequest(request: AiJobResultCommitRequest) {
    const content = request?.content;
    const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
    if (
      typeof request?.resultEventId !== "string" ||
      !isRecord(content) ||
      typeof content.title !== "string" ||
      typeof content.body !== "string" ||
      !Array.isArray(content.tags) ||
      !content.tags.every((item) => typeof item === "string") ||
      !Array.isArray(content.assetIds) ||
      !content.assetIds.every((item) => typeof item === "string") ||
      !isRecord(content.payload) ||
      (content.contentId !== undefined && typeof content.contentId !== "string") ||
      (content.bodyHtml !== undefined && content.bodyHtml !== null && typeof content.bodyHtml !== "string") ||
      (content.bodyJson !== undefined && content.bodyJson !== null && !isRecord(content.bodyJson))
    ) {
      throw new UnprocessableEntityException("invalid AI job result commit payload");
    }
  }

  private payloadHash(value: unknown) {
    return createHash("sha256").update(JSON.stringify(this.canonical(value))).digest("hex");
  }

  private canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.canonical(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, this.canonical(item)]));
    }
    return value;
  }
}
