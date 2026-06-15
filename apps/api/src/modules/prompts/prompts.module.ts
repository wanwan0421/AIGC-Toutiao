import { Module } from "@nestjs/common";
import { AiCoreModule } from "../ai/ai-core.module";
import { AuthModule } from "../auth/auth.module";
import { PromptsController } from "./prompts.controller";
import { PromptsService } from "./prompts.service";

@Module({
  imports: [AuthModule, AiCoreModule],
  controllers: [PromptsController],
  providers: [PromptsService]
})
export class PromptsModule {}
