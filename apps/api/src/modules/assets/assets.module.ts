import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../storage/storage.module";
import { AiCoreModule } from "../ai/ai-core.module";
import { WorkflowModule } from "../workflow/workflow.module";
import { AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";
import { ImageModerationService } from "./image-moderation.service";
import { AdminGuard } from "../auth/admin.guard";

@Module({
  imports: [AuthModule, StorageModule, AiCoreModule, WorkflowModule],
  controllers: [AssetsController],
  providers: [AssetsService, AdminGuard]
})
export class AssetsModule {}
