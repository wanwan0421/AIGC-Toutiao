import { join } from "node:path";

const DEFAULT_UPLOAD_ROUTE = "/api/uploads";

export function getUploadRoot() {
  return process.env.UPLOAD_ROOT?.trim() || join(process.cwd(), "uploads");
}

export function getUploadRoute() {
  return normalizeRoute(process.env.UPLOAD_ROUTE ?? DEFAULT_UPLOAD_ROUTE);
}

export function getUploadPublicBase() {
  return trimTrailingSlash(process.env.UPLOAD_PUBLIC_BASE?.trim() || getUploadRoute());
}

function normalizeRoute(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_UPLOAD_ROUTE;
  return trimmed.startsWith("/") ? trimTrailingSlash(trimmed) : `/${trimTrailingSlash(trimmed)}`;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "") || DEFAULT_UPLOAD_ROUTE;
}
