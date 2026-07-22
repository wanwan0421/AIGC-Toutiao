import { Injectable } from "@nestjs/common";
import type { DirectGenerateRequest } from "@aicp/shared";
import { DraftGeneratorAgent } from "../agents/draft-generator.agent";
import { ImageGenerationService } from "../image-generation.service";

@Injectable()
export class CreativeProductionCapability {
  constructor(
    private readonly draftGenerator: DraftGeneratorAgent,
    private readonly imageGeneration: ImageGenerationService
  ) {}

  generateDraft(request: DirectGenerateRequest, options: { trustedContext?: string; signal?: AbortSignal } = {}) {
    return this.draftGenerator.run(request, options);
  }

  generateSingleImage(input: {
    userId?: string;
    contentId?: string;
    position?: string;
    prompt: string;
    slotId?: string;
    signal?: AbortSignal;
    generationKey?: string;
  }) {
    return this.imageGeneration.generateSingleImage(input);
  }

  imageConfigStatus() {
    return this.imageGeneration.configStatus();
  }
}
