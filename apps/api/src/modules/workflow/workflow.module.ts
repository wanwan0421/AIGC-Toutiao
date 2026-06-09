import { Module } from "@nestjs/common";
import { AiCoreModule } from "../ai/ai-core.module";
import { ContentWorkflowEngine } from "./content-workflow.engine";
import { ScheduledPublishService } from "./scheduled-publish.service";
import { WorkflowJobEventsService } from "./workflow-job-events.service";
import { WorkflowJobRunner } from "./workflow-job.runner";
import { WorkflowJobService } from "./workflow-job.service";

@Module({
  imports: [AiCoreModule],
  providers: [ContentWorkflowEngine, ScheduledPublishService, WorkflowJobEventsService, WorkflowJobRunner, WorkflowJobService],
  exports: [ContentWorkflowEngine, WorkflowJobService],
})
export class WorkflowModule {}
