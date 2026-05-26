import { Injectable } from "@nestjs/common";
import type { SelectionRewriteRequest } from "@aicp/shared";
import { SelectionRewriterAgent } from "../agents/selection-rewriter.agent";

@Injectable()
export class SelectionRewriteSkill {
  constructor(private readonly rewriter: SelectionRewriterAgent) {}

  run(input: SelectionRewriteRequest) {
    return this.rewriter.run(input);
  }
}
