import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PromptScene } from "@aicp/shared";
import { Prisma } from "@prisma/client";
import { toDbPromptScene } from "../../common/prisma-mappers";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class PromptsService {
  constructor(private readonly prisma: PrismaService) {}

  list(scene?: PromptScene) {
    return this.prisma.promptTemplate.findMany({
      where: scene ? { scene: toDbPromptScene(scene) } : undefined,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
    });
  }

  async detail(id: string) {
    return this.getPrompt(id);
  }

  async create(userId: string, body: {
    name: string;
    scene: PromptScene;
    template: string;
    variables?: string[];
    model?: string;
    modelOptions?: Record<string, unknown>;
  }) {
    if (!Object.values(PromptScene).includes(body.scene)) {
      throw new BadRequestException("invalid prompt scene");
    }

    return this.prisma.promptTemplate.create({
      data: {
        creatorId: userId,
        name: body.name,
        scene: toDbPromptScene(body.scene),
        template: body.template,
        variables: (body.variables ?? []) as Prisma.InputJsonValue,
        model: body.model ?? "doubao-seed",
        modelOptions: (body.modelOptions ?? { temperature: 0.7 }) as Prisma.InputJsonValue,
        version: 1,
        status: "draft",
        usageCount: 0
      }
    });
  }

  async update(
    id: string,
    body: Partial<{
      name: string;
      template: string;
      variables: string[];
      model: string;
      modelOptions: Record<string, unknown>;
      status: "active" | "draft" | "disabled";
    }>
  ) {
    await this.getPrompt(id);

    return this.prisma.promptTemplate.update({
      where: { id },
      data: {
        name: body.name,
        template: body.template,
        variables: body.variables as Prisma.InputJsonValue | undefined,
        model: body.model,
        modelOptions: body.modelOptions as Prisma.InputJsonValue | undefined,
        status: body.status,
        version: body.template === undefined ? undefined : { increment: 1 }
      }
    });
  }

  private async getPrompt(id: string) {
    const prompt = await this.prisma.promptTemplate.findUnique({ where: { id } });
    if (!prompt) {
      throw new NotFoundException("prompt not found");
    }

    return prompt;
  }
}
