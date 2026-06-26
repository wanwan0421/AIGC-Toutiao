import { Module } from "@nestjs/common";
import { AiCoreModule } from "../ai/ai-core.module";
import { ContentMetricsModule } from "../content-metrics/content-metrics.module";
import { PromptsModule } from "../prompts/prompts.module";
import { ContentReviewPolicyService } from "./content-review-policy.service";
import { ContentWorkflowEngine } from "./content-workflow.engine";
import { ScheduledPublishService } from "./scheduled-publish.service";
import { WorkflowJobEventsService } from "./workflow-job-events.service";
import { WorkflowJobRunner } from "./workflow-job.runner";
import { WorkflowJobService } from "./workflow-job.service";

@Module({
  imports: [AiCoreModule, ContentMetricsModule, PromptsModule],
  providers: [
    ContentReviewPolicyService,
    ContentWorkflowEngine,
    ScheduledPublishService,
    WorkflowJobEventsService,
    WorkflowJobRunner,
    WorkflowJobService,
  ],
  exports: [ContentReviewPolicyService, ContentWorkflowEngine, WorkflowJobService],
})
export class WorkflowModule {}
