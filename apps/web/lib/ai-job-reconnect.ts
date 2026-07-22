import type { AiJobEvent } from "@aicp/shared";

export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 30_000;
export const RECONNECT_STABLE_WINDOW_MS = 30_000;
export const RETRY_AFTER_MAX_MS = 300_000;

export function isEventAfter(eventId: string, lastEventId?: string) {
  if (!lastEventId) return true;
  if (!/^\d+$/.test(eventId) || !/^\d+$/.test(lastEventId)) return eventId !== lastEventId;
  try {
    return BigInt(eventId) > BigInt(lastEventId);
  } catch {
    return eventId !== lastEventId;
  }
}

export function shouldResetReconnectForEvent(event: AiJobEvent, connectionStartLastEventId?: string) {
  return Boolean(event.id && isEventAfter(event.id, connectionStartLastEventId));
}

export function wasConnectionStable(connectionStartedAt: number, now = Date.now()) {
  return now - connectionStartedAt >= RECONNECT_STABLE_WINDOW_MS;
}

export function reconnectDelay(attempt: number, retryAfterMs?: number, random = Math.random) {
  if (retryAfterMs !== undefined) return Math.min(Math.max(0, retryAfterMs), RETRY_AFTER_MAX_MS);
  const exponential = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
  return Math.round(exponential * (0.8 + random() * 0.4));
}
