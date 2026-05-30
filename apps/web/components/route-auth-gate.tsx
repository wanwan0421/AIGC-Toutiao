"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./auth-provider";
import { LoadingShell } from "./loading-shell";

const publicRoutes = ["/login"];

export function RouteAuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (publicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
      return;
    }

    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [pathname, router, status]);

  if (!publicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    if (status === "loading") {
      return <LoadingShell title="正在确认登录状态..." />;
    }

    if (status === "anonymous") {
      return <LoadingShell title="正在跳转到登录页..." />;
    }
  }

  return <>{children}</>;
}
