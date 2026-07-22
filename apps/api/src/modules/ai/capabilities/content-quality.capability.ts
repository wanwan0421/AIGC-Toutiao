import { Injectable } from "@nestjs/common";
import type { QualityScoreResult } from "@aicp/shared";
import { QualityScoringAgent } from "../agents/quality-scoring.agent";

type ScoreInput = {
  title: string;
  body: string;
};

@Injectable()
export class ContentQualityCapability {
  constructor(private readonly qualityScoring: QualityScoringAgent) {}

  score(input: ScoreInput, options: { signal?: AbortSignal } = {}): Promise<QualityScoreResult> {
    return this.qualityScoring.run(input, options);
  }
}
