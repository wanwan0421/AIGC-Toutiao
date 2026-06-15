import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma, PrismaClient, PromptScene } from "@prisma/client";
import { AI_PROMPT_NAMES } from "../modules/ai/prompt-names";

type HighRiskSample = {
  id: string;
  title: string;
  body: string;
  expectedRiskLevel?: string;
  expectedHighRisk?: boolean;
  category?: string;
  rationale?: string;
};

const prisma = new PrismaClient();

async function main() {
  const samplesPath = resolve(process.cwd(), "../../docs/evaluation/high-risk-eval-samples.json");
  const samples = JSON.parse(readFileSync(samplesPath, "utf8")) as HighRiskSample[];
  if (!Array.isArray(samples)) {
    throw new Error("high-risk eval samples must be an array");
  }

  const definition = await prisma.promptDefinition.upsert({
    where: { key: AI_PROMPT_NAMES.safetyReview },
    create: {
      key: AI_PROMPT_NAMES.safetyReview,
      scene: PromptScene.audit,
      displayName: "Safety Review",
      status: "active",
    },
    update: {
      scene: PromptScene.audit,
      displayName: "Safety Review",
    },
  });

  await prisma.promptTestCase.deleteMany({
    where: {
      definitionId: definition.id,
      name: { startsWith: "HR-" },
    },
  });

  await prisma.promptTestCase.createMany({
    data: samples.map((sample) => ({
      definitionId: definition.id,
      name: `${sample.id} ${sample.category ?? ""}`.trim(),
      input: {
        title: sample.title,
        body: sample.body,
        ruleRiskItemsJson: "[]",
      } as Prisma.InputJsonObject,
      assertions: {
        expectedRiskLevel: sample.expectedRiskLevel,
        expectedHighRisk: sample.expectedHighRisk,
        category: sample.category,
        rationale: sample.rationale,
      } as Prisma.InputJsonObject,
      expectedOutput: {
        riskLevel: sample.expectedRiskLevel,
        expectedHighRisk: sample.expectedHighRisk,
      } as Prisma.InputJsonObject,
      enabled: true,
    })),
  });

  console.log(`Seeded ${samples.length} safety_review eval cases.`);
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
