import { Injectable } from "@nestjs/common";
import type { DirectGenerateRequest } from "@aicp/shared";
import { DraftGeneratorAgent } from "../agents/draft-generator.agent";
import { ImageGenerationService } from "../image-generation.service";

@Injectable()
export class CreativeProductionSkill {
  constructor(
    private readonly draftGenerator: DraftGeneratorAgent,
    private readonly imageGeneration: ImageGenerationService
  ) {}

  async directGenerate(request: DirectGenerateRequest) {
    const draft = await this.draftGenerator.run(request);
    const generatedImages = await this.imageGeneration.generateForDraft({
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
  }
}
