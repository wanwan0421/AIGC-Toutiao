import { Module } from "@nestjs/common";
import { WorkflowModule } from "../workflow/workflow.module";
import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [WorkflowModule, AuthModule],
  controllers: [ModerationController],
  providers: [ModerationService],
})
export class ModerationModule {}
