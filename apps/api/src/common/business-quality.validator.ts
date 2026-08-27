export type BusinessQualityIssue = { path: string; message: string };

const MAX_GENERIC_ARRAY_ITEMS = 1_000;

export function validateBusinessQuality(value: unknown, path = "body", depth = 0): BusinessQualityIssue | null {
  if (depth > 8) return { path, message: "object nesting exceeds 8 levels" };
  if (typeof value === "string" && value.length > 20_000) {
    return { path, message: "text exceeds 20000 characters" };
  }

  if (Array.isArray(value)) {
    const limit = arrayLimit(path);
    if (value.length > limit) return { path, message: `array exceeds ${limit} items` };
    for (let index = 0; index < value.length; index += 1) {
      const issue = validateBusinessQuality(value[index], `${path}.${index}`, depth + 1);
      if (issue) return issue;
    }
    return null;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 50) return { path, message: "object has too many fields" };
    for (const [key, child] of entries) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        return { path: `${path}.${key}`, message: "unsafe field name" };
      }
      const issue = validateBusinessQuality(child, `${path}.${key}`, depth + 1);
      if (issue) return issue;
    }
  }
  return null;
}

function arrayLimit(path: string) {
  const field = path.split(".").at(-1)?.toLowerCase() ?? "";
  if (["images", "imageprompts", "imageassets", "generatedimagecandidates"].includes(field)) return 5;
  if (["assets", "assetids", "materials", "materialids", "tags"].includes(field)) return 10;
  return MAX_GENERIC_ARRAY_ITEMS;
}
