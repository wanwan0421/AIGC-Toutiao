"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./auth-provider";
import { LoadingShell } from "./loading-shell";

const legacyProtectedRoutes = ["/dashboard", "/editor", "/analytics", "/prompts", "/growth"];

export function RouteAuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useAuth();
  const isProtectedRoute =
    pathname.startsWith("/studio") ||
    pathname === "/content" ||
    legacyProtectedRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  useEffect(() => {
    if (!isProtectedRoute) return;
    if (status === "anonymous") {
      const returnTo = encodeURIComponent(`${pathname}${window.location.search}`);
      router.replace(`/login?returnTo=${returnTo}`);
    }
  }, [isProtectedRoute, pathname, router, status]);

  if (isProtectedRoute) {
    if (status === "loading") {
      return <LoadingShell title="正在确认登录状态..." />;
    }

    if (status === "anonymous") {
      return <LoadingShell title="正在跳转到登录页..." />;
    }
  }

  return <>{children}</>;
}
