const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const apiRoot = resolve(__dirname, "..");
const schemaPath = resolve(apiRoot, "prisma", "schema.prisma");

function namedBlocks(schema, keyword) {
  const blocks = new Map();
  const pattern = new RegExp(`(?:^|\\n)${keyword}\\s+(\\w+)\\s*\\{([\\s\\S]*?)\\n\\}`, "g");
  for (const match of schema.matchAll(pattern)) {
    blocks.set(match[1], match[2]);
  }
  return blocks;
}

function blockMembers(body, kind) {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/)[0])
    .filter((name) => kind === "model" || !name.startsWith("@"));
}

function expectedContract(schema) {
  return {
    models: new Map(
      [...namedBlocks(schema, "model")].map(([name, body]) => [name, blockMembers(body, "model")])
    ),
    enums: new Map(
      [...namedBlocks(schema, "enum")].map(([name, body]) => [name, blockMembers(body, "enum")])
    ),
  };
}

function actualContract() {
  const { Prisma } = require("@prisma/client");
  return {
    models: new Map(
      Prisma.dmmf.datamodel.models.map((model) => [model.name, model.fields.map((field) => field.name)])
    ),
    enums: new Map(
      Prisma.dmmf.datamodel.enums.map((item) => [
        item.name,
        item.values.map((value) => (typeof value === "string" ? value : value.name)),
      ])
    ),
  };
}

function differences(expected, actual) {
  const issues = [];
  for (const kind of ["models", "enums"]) {
    const expectedEntries = expected[kind];
    const actualEntries = actual[kind];
    for (const [name, members] of expectedEntries) {
      const generatedMembers = actualEntries.get(name);
      if (!generatedMembers) {
        issues.push(`${kind.slice(0, -1)} ${name} is missing`);
        continue;
      }
      const missing = members.filter((member) => !generatedMembers.includes(member));
      const extra = generatedMembers.filter((member) => !members.includes(member));
      if (missing.length || extra.length) {
        issues.push(
          `${kind.slice(0, -1)} ${name} differs` +
            `${missing.length ? `; missing: ${missing.join(", ")}` : ""}` +
            `${extra.length ? `; extra: ${extra.join(", ")}` : ""}`
        );
      }
    }
    for (const name of actualEntries.keys()) {
      if (!expectedEntries.has(name)) issues.push(`generated ${kind.slice(0, -1)} ${name} is no longer in schema`);
    }
  }
  return issues;
}

const schema = readFileSync(schemaPath, "utf8");
const issues = differences(expectedContract(schema), actualContract());

if (!issues.length) {
  console.log("Prisma Client is synchronized with prisma/schema.prisma.");
  process.exit(0);
}

console.warn("Prisma Client is stale:");
for (const issue of issues) console.warn(`- ${issue}`);
console.warn("Regenerating Prisma Client...");

const prismaCli = require.resolve("prisma/build/index.js");
const generated = spawnSync(
  process.execPath,
  [prismaCli, "generate", "--schema", schemaPath],
  { cwd: apiRoot, stdio: "inherit" }
);

if (generated.status !== 0) {
  console.error(
    "Unable to regenerate Prisma Client. On Windows, stop every running API/Worker process that holds query_engine-windows.dll.node, then run `npm.cmd run db:generate` and restart them."
  );
  process.exit(generated.status || 1);
}

