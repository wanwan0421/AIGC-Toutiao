import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma/prisma.service";

export type PromptRenderResult = {
  promptKey?: string;
  promptVersionId?: string;
  model?: string;
  modelOptions?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  prompt: string;
};

@Injectable()
export class PromptTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async render(scene: string, variables: Record<string, unknown>, fallbackTemplate = ""): Promise<PromptRenderResult> {
    const exactDefinition = await this.prisma.promptDefinition
      .findFirst({
        where: {
          status: "active",
          key: scene,
          activeVersionId: { not: null },
        },
        include: { activeVersion: true },
      })
      .catch(() => null);

    if (exactDefinition?.activeVersion) {
      await this.prisma.promptDefinition
        .update({
          where: { id: exactDefinition.id },
          data: { usageCount: { increment: 1 } },
        })
        .catch(() => undefined);

      return {
        promptKey: exactDefinition.key,
        promptVersionId: exactDefinition.activeVersion.id,
        model: exactDefinition.activeVersion.model ?? undefined,
        modelOptions: this.jsonObject(exactDefinition.activeVersion.modelOptions),
        outputSchema: this.jsonObject(exactDefinition.activeVersion.outputSchema),
        prompt: this.interpolate(exactDefinition.activeVersion.template, variables),
      };
    }

    return {
      promptKey: scene,
      prompt: this.interpolate(fallbackTemplate, variables),
    };
  }

  private interpolate(template: string, variables: Record<string, unknown>) {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
      const value = key.split(".").reduce<unknown>((current, part) => {
        if (current && typeof current === "object" && part in current) {
          return (current as Record<string, unknown>)[part];
        }
        return undefined;
      }, variables);

      if (Array.isArray(value)) return value.join("\n");
      if (value === null || value === undefined) return "";
      return String(value);
    });
  }

  private jsonObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }
}
