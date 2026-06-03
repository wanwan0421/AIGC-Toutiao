import { Injectable } from "@nestjs/common";
import type { QualityScoreResult } from "@aicp/shared";
import { QualityScoringAgent } from "../agents/quality-scoring.agent";

type ScoreInput = {
  title: string;
  body: string;
};

@Injectable()
export class ContentQualitySkill {
  constructor(private readonly qualityScoring: QualityScoringAgent) {}

  // 质量评分是分发/推荐参考，不参与安全审核是否通过的判断。
  score(input: ScoreInput): Promise<QualityScoreResult> {
    return this.qualityScoring.run(input);
  }
}
