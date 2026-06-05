import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../storage/storage.module";
import { AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [AssetsController],
  providers: [AssetsService]
})
export class AssetsModule {}
