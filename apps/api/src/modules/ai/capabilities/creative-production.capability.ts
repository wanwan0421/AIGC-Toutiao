import { Injectable, Logger } from "@nestjs/common";
import type { DirectGenerateRequest } from "@aicp/shared";
import { DraftGeneratorAgent } from "../agents/draft-generator.agent";
import { ImageGenerationService } from "../image-generation.service";

@Injectable()
export class CreativeProductionCapability {
  private readonly logger = new Logger(CreativeProductionCapability.name);

  constructor(
    private readonly draftGenerator: DraftGeneratorAgent,
    private readonly imageGeneration: ImageGenerationService
  ) {}

  generateDraft(request: DirectGenerateRequest, options: { trustedContext?: string } = {}) {
    return this.draftGenerator.run(request, options);
  }

  generateImagesForDraft(input: {
    userId?: string;
    contentId?: string;
    coverSuggestion?: string;
    imagePrompts: Array<{ position: string; prompt: string }>;
  }) {
    return this.imageGeneration.generateForDraft(input);
  }

  generateSingleImage(input: {
    userId?: string;
    contentId?: string;
    position?: string;
    prompt: string;
  }) {
    return this.imageGeneration.generateSingleImage(input);
  }

  async directGenerate(request: DirectGenerateRequest) {
    try {
      const draft = await this.generateDraft(request);
      const generatedImages = await this.generateImagesForDraft({
        userId: request.userId,
        contentId: request.contentId,
        coverSuggestion: draft.coverSuggestion,
        imagePrompts: draft.imagePrompts,
      });

      return {
        ...draft,
        coverAsset: generatedImages.coverAsset,
        imageAssets: generatedImages.imageAssets,
      };
    } catch (error) {
      this.logger.error(`Direct creative generation failed: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  imageConfigStatus() {
    return this.imageGeneration.configStatus();
  }
}
