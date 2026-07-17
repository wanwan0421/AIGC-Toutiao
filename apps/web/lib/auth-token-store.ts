type AuthMemoryMessage =
  | {
      type: "session";
      accessToken: string;
      expiresAt: number;
      csrfToken: string;
    }
  | { type: "clear" };

const AUTH_CHANNEL_NAME = "aicp:auth-memory";

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
let csrfToken: string | null = null;
let authChannel: BroadcastChannel | null = null;

function isBrowser() {
  return typeof window !== "undefined";
}

function ensureAuthChannel() {
  if (!isBrowser() || typeof BroadcastChannel === "undefined" || authChannel) return authChannel;
  authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME);
  authChannel.onmessage = (event: MessageEvent<AuthMemoryMessage>) => {
    const message = event.data;
    if (message?.type === "session" && message.expiresAt > Date.now()) {
      accessToken = message.accessToken;
      accessTokenExpiresAt = message.expiresAt;
      csrfToken = message.csrfToken;
    } else if (message?.type === "clear") {
      accessToken = null;
      accessTokenExpiresAt = 0;
      csrfToken = null;
    }
  };
  return authChannel;
}

export function getAccessToken() {
  if (!isBrowser()) return null;
  ensureAuthChannel();
  return accessToken;
}

export function getAccessTokenExpiresAt() {
  if (!isBrowser()) return 0;
  return accessTokenExpiresAt;
}

export function getCsrfToken() {
  if (!isBrowser()) return null;
  ensureAuthChannel();
  return csrfToken;
}

export function hasUsableAccessToken(minimumValidityMs = 30_000) {
  return Boolean(getAccessToken() && getAccessTokenExpiresAt() > Date.now() + minimumValidityMs);
}

export function setAuthSessionMemory(token: string, expiresInSeconds: number, nextCsrfToken: string) {
  if (!isBrowser()) return;
  accessToken = token;
  accessTokenExpiresAt = Date.now() + expiresInSeconds * 1000;
  csrfToken = nextCsrfToken;
  ensureAuthChannel()?.postMessage({
    type: "session",
    accessToken: token,
    expiresAt: accessTokenExpiresAt,
    csrfToken: nextCsrfToken
  } satisfies AuthMemoryMessage);
}

export function setCsrfTokenMemory(token: string) {
  if (!isBrowser()) return;
  csrfToken = token;
  ensureAuthChannel();
}

export function clearAccessTokenMemory() {
  if (!isBrowser()) return;
  accessToken = null;
  accessTokenExpiresAt = 0;
}

export function clearAuthMemory(broadcast = true) {
  if (!isBrowser()) return;
  accessToken = null;
  accessTokenExpiresAt = 0;
  csrfToken = null;
  if (broadcast) {
    ensureAuthChannel()?.postMessage({ type: "clear" } satisfies AuthMemoryMessage);
  }
}
