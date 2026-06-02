import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkflowModule } from "../workflow/workflow.module";
import { AiController } from "./ai.controller";

@Module({
  imports: [AuthModule, WorkflowModule],
  controllers: [AiController],
})
export class AiModule {}
