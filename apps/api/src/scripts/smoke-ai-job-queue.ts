import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AiJobType } from "@aicp/shared";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../infra/prisma/prisma.service";
import { RedisService } from "../infra/redis/redis.service";
import { WorkflowJobQueueService } from "../modules/workflow/workflow-job-queue.service";
import { WorkflowJobService } from "../modules/workflow/workflow-job.service";
import { WorkflowJobResultCommitService } from "../modules/workflow/workflow-job-result-commit.service";
import { WorkerAppModule } from "../worker-app.module";

async function main() {
  process.env.AI_JOB_PROCESS_ROLE = "worker";
  const app = await NestFactory.createApplicationContext(WorkerAppModule, { logger: ["error", "warn"] });
  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const jobs = app.get(WorkflowJobService);
  const queue = app.get(WorkflowJobQueueService);
  const resultCommit = app.get(WorkflowJobResultCommitService);
  let jobId: string | undefined;
  let commitJobId: string | undefined;
  let committedContentId: string | undefined;
  try {
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) throw new Error("smoke test requires at least one seeded user");
    const job = await jobs.create({ userId: user.id, type: AiJobType.ComplianceRewrite, payload: {} });
    jobId = job.id;
    const terminal = await waitForTerminal(prisma, job.id);
    const queueState = await waitForQueueState(queue, job.id, "failed");
    const errorEvents = await prisma.aiJobEvent.count({ where: { jobId: job.id, type: "error" } });
    if (terminal.status !== "failed" || queueState !== "failed" || errorEvents !== 1) {
      throw new Error(`unexpected smoke result: status=${terminal.status}, queueState=${queueState}, errorEvents=${errorEvents}`);
    }
    process.stdout.write(`AI job queue smoke passed: ${job.id}\n`);

    commitJobId = randomUUID();
    await prisma.aiJob.create({
      data: {
        id: commitJobId,
        userId: user.id,
        type: "creative_direct_generate",
        status: "awaiting_commit",
        progress: 95,
        input: {},
        result: { title: "smoke" },
        resultReadyAt: new Date(),
      },
    });
    const resultReady = await prisma.aiJobEvent.create({
      data: { jobId: commitJobId, type: "result_ready", data: { result: { title: "smoke" } } },
    });
    const request = {
      resultEventId: resultReady.id.toString(),
      content: {
        title: "AI job commit smoke",
        body: "atomic commit smoke body",
        bodyHtml: "<p>atomic commit smoke body</p>",
        bodyJson: null,
        tags: ["smoke"],
        assetIds: [],
        payload: { html: "<p>atomic commit smoke body</p>", tags: ["smoke"], assetIds: [] },
      },
    };
    const firstCommit = await resultCommit.commit(user.id, commitJobId, request);
    const secondCommit = await resultCommit.commit(user.id, commitJobId, request);
    committedContentId = firstCommit.content.id;
    const doneEvents = await prisma.aiJobEvent.count({ where: { jobId: commitJobId, type: "done" } });
    if (secondCommit.content.id !== firstCommit.content.id || doneEvents !== 1) {
      throw new Error(`result commit is not idempotent: doneEvents=${doneEvents}`);
    }
    process.stdout.write(`AI job result commit smoke passed: ${commitJobId}\n`);
  } finally {
    if (jobId) {
      await prisma.aiJob.deleteMany({ where: { id: jobId } });
      const bullJob = await queue.queue.getJob(jobId).catch(() => undefined);
      await bullJob?.remove().catch(() => undefined);
      await redis.getClient().del(`ai-job:${jobId}:events`).catch(() => 0);
    }
    if (commitJobId) {
      await prisma.aiJob.deleteMany({ where: { id: commitJobId } });
      await redis.getClient().del(`ai-job:${commitJobId}:events`).catch(() => 0);
    }
    if (committedContentId) {
      await prisma.draft.deleteMany({ where: { contentId: committedContentId } });
      await prisma.contentAsset.deleteMany({ where: { contentId: committedContentId } });
      await prisma.content.deleteMany({ where: { id: committedContentId } });
    }
    await app.close();
  }
}

async function waitForTerminal(prisma: PrismaService, jobId: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return job;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("AI job queue smoke timed out");
}

async function waitForQueueState(queue: WorkflowJobQueueService, jobId: string, expected: string) {
  const deadline = Date.now() + 5_000;
  let state = "missing";
  while (Date.now() < deadline) {
    const job = await queue.queue.getJob(jobId);
    state = job ? await job.getState() : "missing";
    if (state === expected) return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return state;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
