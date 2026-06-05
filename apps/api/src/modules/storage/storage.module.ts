import { Module } from "@nestjs/common";
import { LocalStorageAdapter, StorageService } from "./storage.service";

@Module({
  providers: [LocalStorageAdapter, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
