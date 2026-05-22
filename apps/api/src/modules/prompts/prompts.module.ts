import { Module } from "@nestjs/common";
import { PromptsController } from "./prompts.controller";
import { PromptsService } from "./prompts.service";

@Module({
  controllers: [PromptsController],
  providers: [PromptsService]
})
export class PromptsModule {}
