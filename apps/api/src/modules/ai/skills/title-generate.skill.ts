import { Injectable } from "@nestjs/common";
import type { TitleGenerateRequest } from "@aicp/shared";
import { TitleAgent } from "../agents/title.agent";

@Injectable()
export class TitleGenerateSkill {
  constructor(private readonly titleAgent: TitleAgent) {}

  run(input: TitleGenerateRequest) {
    return this.titleAgent.run(input);
  }
}
