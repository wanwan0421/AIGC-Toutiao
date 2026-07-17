import { NextResponse, type NextRequest } from "next/server";

const legacyStudioRoutes: Record<string, string> = {
  "/dashboard": "/studio/dashboard",
  "/editor": "/studio/editor",
  "/content": "/studio/content",
  "/analytics": "/studio/analytics",
  "/prompts": "/studio/prompts",
};

const studioRewriteRoutes: Record<string, string> = {
  "/studio/dashboard": "/dashboard",
  "/studio/editor": "/editor",
  "/studio/content": "/content",
  "/studio/analytics": "/analytics",
  "/studio/prompts": "/prompts",
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (legacyStudioRoutes[pathname]) {
    return redirectWithSearch(request, legacyStudioRoutes[pathname]);
  }

  if (pathname === "/growth" || pathname.startsWith("/growth/")) {
    return redirectWithSearch(request, `/studio${pathname}`);
  }

  if (pathname === "/studio") {
    return redirectWithSearch(request, "/studio/dashboard");
  }

  if (studioRewriteRoutes[pathname]) {
    return rewriteWithSearch(request, studioRewriteRoutes[pathname]);
  }

  if (pathname === "/studio/growth" || pathname.startsWith("/studio/growth/")) {
    return rewriteWithSearch(request, pathname.replace(/^\/studio/, ""));
  }

  return NextResponse.next();
}

function redirectWithSearch(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.redirect(url);
}

function rewriteWithSearch(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    "/dashboard",
    "/editor",
    "/content",
    "/analytics",
    "/prompts",
    "/growth/:path*",
    "/studio",
    "/studio/:path*",
  ],
};
