import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../storage/storage.module";
import { AiCoreModule } from "../ai/ai-core.module";
import { AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";
import { ImageModerationService } from "./image-moderation.service";

@Module({
  imports: [AuthModule, StorageModule, AiCoreModule],
  controllers: [AssetsController],
  providers: [AssetsService, ImageModerationService]
})
export class AssetsModule {}
