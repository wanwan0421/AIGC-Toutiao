import { Module } from "@nestjs/common";
import { WorkflowModule } from "../workflow/workflow.module";
import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";

@Module({
  imports: [WorkflowModule],
  controllers: [ModerationController],
  providers: [ModerationService],
})
export class ModerationModule {}
