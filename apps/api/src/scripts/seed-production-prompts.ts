import { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_PROMPT_SEEDS } from "../modules/ai/default-prompt-seeds";

const prisma = new PrismaClient();

async function main() {
  const model = process.env.ARK_MODEL_ID ?? process.env.ARK_MODEL ?? null;
  const forceUpdate = process.env.PROMPT_INIT_FORCE_UPDATE === "true";

  for (const seed of DEFAULT_PROMPT_SEEDS) {
    const definition = await prisma.promptDefinition.upsert({
      where: { key: seed.key },
      create: {
        key: seed.key,
        scene: seed.scene,
        displayName: seed.displayName,
        status: "active",
      },
      update: {
        scene: seed.scene,
        displayName: seed.displayName,
        status: "active",
      },
    });

    if (definition.activeVersionId && !forceUpdate) {
      continue;
    }

    const latest = await prisma.promptVersion.findFirst({
      where: { definitionId: definition.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const version = await prisma.promptVersion.create({
      data: {
        definitionId: definition.id,
        version: (latest?.version ?? 0) + 1,
        template: seed.template,
        variables: seed.variables,
        model,
        modelOptions: seed.modelOptions as Prisma.InputJsonObject,
        status: "active",
        changeNote: forceUpdate ? "Production prompt refresh" : "Production prompt initialization",
      },
    });

    await prisma.promptDefinition.update({
      where: { id: definition.id },
      data: { activeVersionId: version.id },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
