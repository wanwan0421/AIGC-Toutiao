import { Module } from "@nestjs/common";
import { AiCoreModule } from "../ai/ai-core.module";
import { ContentWorkflowEngine } from "./content-workflow.engine";

@Module({
  imports: [AiCoreModule],
  providers: [ContentWorkflowEngine],
  exports: [ContentWorkflowEngine],
})
export class WorkflowModule {}
