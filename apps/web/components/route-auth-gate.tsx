"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getCurrentUser } from "../lib/api";

const publicRoutes = ["/login"];

export function RouteAuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      if (publicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
        setChecking(false);
        return;
      }

      setChecking(true);
      try {
        await getCurrentUser();
        if (!cancelled) {
          setChecking(false);
        }
      } catch {
        if (!cancelled) {
          router.replace("/login");
        }
      }
    }

    void checkAuth();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (checking) {
    return (
      <div className="grid min-h-[calc(100vh-64px)] place-items-center bg-slate-50 text-sm font-semibold text-slate-500">
        正在确认登录状态...
      </div>
    );
  }

  return <>{children}</>;
}
