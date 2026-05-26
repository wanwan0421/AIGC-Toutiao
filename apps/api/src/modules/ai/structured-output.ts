export function parseJsonObject<T>(value: string): T | null {
  const trimmed = value.trim();
  const direct = tryParse<T>(trimmed);
  if (direct) return direct;

  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? tryParse<T>(match[0]) : null;
}

function tryParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
