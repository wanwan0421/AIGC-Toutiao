import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LocalStorageAdapter, StorageService } from "../modules/storage/storage.service";

async function main() {
  await loadEnvFiles();
  const prisma = new PrismaClient();
  const storage = new StorageService(new LocalStorageAdapter());

  try {
    const assets = await prisma.asset.findMany({
      where: {
        source: "ai_generated",
        OR: [{ url: { startsWith: "http://" } }, { url: { startsWith: "https://" } }, { url: { startsWith: "data:" } }],
      },
      orderBy: { createdAt: "asc" },
    });

    let migrated = 0;
    let failed = 0;

    for (const asset of assets) {
      try {
        const stored = asset.url.startsWith("data:")
          ? await storage.saveDataUrl(asset.url, {
              folder: "ai-images",
              fileName: asset.fileName,
              mimeType: asset.mimeType,
            })
          : await storage.saveRemoteFile(asset.url, {
              folder: "ai-images",
              fileName: asset.fileName,
              mimeType: asset.mimeType,
            });

        await prisma.asset.update({
          where: { id: asset.id },
          data: {
            fileName: stored.fileName,
            mimeType: stored.mimeType,
            url: stored.url,
            metadata: {
              ...asRecord(asset.metadata),
              storageKey: stored.storageKey,
              size: stored.size,
              migratedAt: new Date().toISOString(),
              migratedFromProviderHost: asset.url.startsWith("data:") ? "data_url" : hostFromUrl(asset.url),
            },
          },
        });

        migrated += 1;
        console.log(`migrated ${asset.id} -> ${stored.url}`);
      } catch (error) {
        failed += 1;
        console.warn(`failed ${asset.id}: ${(error as Error).message}`);
      }
    }

    console.log(`AI image asset migration finished. migrated=${migrated}, failed=${failed}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function loadEnvFiles() {
  const candidates = [join(process.cwd(), ".env"), join(process.cwd(), "apps/api/.env")];
  for (const file of candidates) {
    const content = await readFile(file, "utf8").catch(() => "");
    if (!content) continue;

    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = stripEnvQuotes(match[2]);
    }
  }
}

function stripEnvQuotes(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function hostFromUrl(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
