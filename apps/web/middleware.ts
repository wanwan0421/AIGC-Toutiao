import { NextResponse, type NextRequest } from "next/server";

const ACCESS_COOKIE_NAME = "aicp.accessToken";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname !== "/") {
    return NextResponse.next();
  }

  const destination = request.cookies.has(ACCESS_COOKIE_NAME) ? "/dashboard" : "/login";
  return NextResponse.redirect(new URL(destination, request.url));
}

export const config = {
  matcher: "/",
};
