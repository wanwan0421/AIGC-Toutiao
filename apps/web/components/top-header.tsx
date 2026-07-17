"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { logout } from "../lib/api";
import { useAuth } from "./auth-provider";

export function TopHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const { profile, status, clearSession } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout().catch(() => undefined);
    } finally {
      clearSession();
      setLoggingOut(false);
      router.push("/");
    }
  }

  if (pathname === "/login") {
    return null;
  }

  const loginHref = `/login?returnTo=${encodeURIComponent(pathname)}`;

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center border-b border-slate-200/70 bg-white/95 px-6 backdrop-blur-md">
      <Link href="/" className="flex min-w-0 items-center gap-2 text-2xl font-bold text-[#ff2442] transition hover:text-rose-600">
        <span className="whitespace-nowrap">今日头条创作服务平台</span>
      </Link>
      <div className="ml-auto flex items-center gap-4">
        {status === "loading" ? null : profile ? (
          <div className="flex items-center gap-3 text-sm text-slate-700">
            <Link href="/studio/dashboard" className="flex min-w-0 items-center gap-3 px-2 py-1">
              {profile.avatarUrl ? (
                <img alt={profile.nickname} className="h-10 w-10 rounded-full object-cover ring-1 ring-slate-200" src={profile.avatarUrl} />
              ) : (
                <div className="grid h-10 w-10 place-items-center rounded-full bg-rose-600 text-sm font-black text-white ring-1 ring-rose-100">
                  {profile.nickname.slice(0, 1).toUpperCase() || "创"}
                </div>
              )}
              <div className="hidden min-w-0 text-right sm:block">
                <p className="max-w-36 truncate text-sm font-semibold text-slate-900">{profile.nickname}</p>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogOut className="h-3.5 w-3.5" />
              {loggingOut ? "退出中" : "退出"}
            </button>
          </div>
        ) : (
          <Link href={loginHref} className="inline-flex h-9 items-center gap-2 rounded-full bg-rose-600 px-4 text-sm font-bold text-white transition hover:bg-rose-700">
            <UserRound className="h-4 w-4" />
            登录 / 注册
          </Link>
        )}
      </div>
    </header>
  );
}
