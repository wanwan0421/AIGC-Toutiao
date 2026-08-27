import { Module } from "@nestjs/common";
import { AiCoreModule } from "../ai/ai-core.module";
import { ContentMetricsModule } from "../content-metrics/content-metrics.module";
import { PromptsModule } from "../prompts/prompts.module";
import { ContentReviewPolicyService } from "./content-review-policy.service";
import { ContentWorkflowEngine } from "./content-workflow.engine";
import { ScheduledPublishService } from "./scheduled-publish.service";
import { WorkflowJobEventsService } from "./workflow-job-events.service";
import { WorkflowJobDispatcherService } from "./workflow-job-dispatcher.service";
import { WorkflowJobQueueService } from "./workflow-job-queue.service";
import { WorkflowJobMaintenanceService } from "./workflow-job-maintenance.service";
import { WorkflowJobWorkerService } from "./workflow-job-worker.service";
import { ContentDraftPersistenceService } from "./content-draft-persistence.service";
import { WorkflowJobResultCommitService } from "./workflow-job-result-commit.service";
import { WorkflowJobRunner } from "./workflow-job.runner";
import { WorkflowJobService } from "./workflow-job.service";
import { AiJobPayloadValidator } from "./ai-job-payload.validator";
import { UserRateLimitService } from "./user-rate-limit.service";
import { AiJobHandlerRegistry } from "./ai-job-handler.registry";

@Module({
  imports: [AiCoreModule, ContentMetricsModule, PromptsModule],
  providers: [
    ContentReviewPolicyService,
    ContentWorkflowEngine,
    ScheduledPublishService,
    WorkflowJobEventsService,
    WorkflowJobQueueService,
    WorkflowJobDispatcherService,
    WorkflowJobMaintenanceService,
    WorkflowJobWorkerService,
    ContentDraftPersistenceService,
    WorkflowJobResultCommitService,
    WorkflowJobRunner,
    WorkflowJobService,
    AiJobPayloadValidator,
    UserRateLimitService,
    AiJobHandlerRegistry,
  ],
  exports: [
    ContentReviewPolicyService,
    ContentWorkflowEngine,
    WorkflowJobEventsService,
    WorkflowJobQueueService,
    ContentDraftPersistenceService,
    WorkflowJobResultCommitService,
    WorkflowJobRunner,
    WorkflowJobService,
    UserRateLimitService,
  ],
})
export class WorkflowModule {}
