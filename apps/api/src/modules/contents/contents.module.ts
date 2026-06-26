import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ContentMetricsModule } from "../content-metrics/content-metrics.module";
import { WorkflowModule } from "../workflow/workflow.module";
import { ContentAccessPolicyService } from "./content-access-policy.service";
import { ContentsController } from "./contents.controller";
import { ContentsService } from "./contents.service";

@Module({
  imports: [AuthModule, ContentMetricsModule, WorkflowModule],
  controllers: [ContentsController],
  providers: [ContentsService, ContentAccessPolicyService],
  exports: [ContentAccessPolicyService],
})
export class ContentsModule {}
