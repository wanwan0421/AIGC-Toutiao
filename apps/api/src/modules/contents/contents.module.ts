import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkflowModule } from "../workflow/workflow.module";
import { ContentsController } from "./contents.controller";
import { ContentsService } from "./contents.service";

@Module({
  imports: [AuthModule, WorkflowModule],
  controllers: [ContentsController],
  providers: [ContentsService]
})
export class ContentsModule {}
