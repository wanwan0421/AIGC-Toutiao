import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkflowModule } from "../workflow/workflow.module";
import { DraftsController } from "./drafts.controller";
import { DraftsService } from "./drafts.service";

@Module({
  imports: [AuthModule, WorkflowModule],
  controllers: [DraftsController],
  providers: [DraftsService]
})
export class DraftsModule {}
