export function parseJsonObject<T>(value: string): T | null {
  const trimmed = value.trim();
  const unwrapped = trimmed.startsWith("```json") && trimmed.endsWith("```")
    ? trimmed.slice(7, -3).trim()
    : trimmed;
  const parsed = tryParse<unknown>(unwrapped);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as T;
}

function tryParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
