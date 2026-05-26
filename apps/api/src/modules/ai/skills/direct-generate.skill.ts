import { Injectable } from "@nestjs/common";
import type { DirectGenerateRequest } from "@aicp/shared";
import { DraftGeneratorAgent } from "../agents/draft-generator.agent";

@Injectable()
export class DirectGenerateSkill {
  constructor(private readonly draftGenerator: DraftGeneratorAgent) {}

  run(input: DirectGenerateRequest) {
    return this.draftGenerator.run(input);
  }
}
