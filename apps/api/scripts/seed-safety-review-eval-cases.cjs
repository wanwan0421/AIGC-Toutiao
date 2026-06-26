const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { PrismaClient, PromptScene } = require("@prisma/client");

const SAFETY_REVIEW_PROMPT_KEY = "safety_review";
const prisma = new PrismaClient();

async function main() {
  const samplesPath = resolve(process.cwd(), "../../docs/evaluation/high-risk-eval-samples.json");
  const samples = JSON.parse(readFileSync(samplesPath, "utf8"));
  if (!Array.isArray(samples)) {
    throw new Error("high-risk eval samples must be an array");
  }

  const definition = await prisma.promptDefinition.upsert({
    where: { key: SAFETY_REVIEW_PROMPT_KEY },
    create: {
      key: SAFETY_REVIEW_PROMPT_KEY,
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
      },
      assertions: {
        expectedRiskLevel: sample.expectedRiskLevel,
        expectedHighRisk: sample.expectedHighRisk,
        category: sample.category,
        rationale: sample.rationale,
      },
      expectedOutput: {
        riskLevel: sample.expectedRiskLevel,
        expectedHighRisk: sample.expectedHighRisk,
      },
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
