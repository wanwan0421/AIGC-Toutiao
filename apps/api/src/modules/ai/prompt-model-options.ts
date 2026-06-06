export function promptTemperature(modelOptions: Record<string, unknown> | null | undefined, fallback: number) {
  const raw = modelOptions?.temperature;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(2, Math.max(0, value));
}
