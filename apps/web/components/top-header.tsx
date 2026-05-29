"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import type { UserProfileSummary } from "@aicp/shared";
import { getCurrentUser, logout } from "../lib/api";

export function TopHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<UserProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const currentUser = await getCurrentUser();
        if (!cancelled) setProfile(currentUser);
      } catch {
        if (!cancelled) setProfile(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const userInitial = useMemo(() => profile?.nickname?.slice(0, 1).toUpperCase() || "创", [profile]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout().catch(() => undefined);
    } finally {
      setProfile(null);
      setLoggingOut(false);
      router.push("/login");
      router.refresh();
    }
  }

  if (pathname === "/login") {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center border-b border-slate-200/70 bg-white/95 px-6 backdrop-blur-md">
      <div className="mx-auto flex w-full items-center justify-end gap-4">
        {loading ? (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-full bg-slate-100" />
            <div className="space-y-2 text-right">
              <div className="h-3 w-24 animate-pulse rounded-full bg-slate-100" />
              <div className="ml-auto h-2.5 w-16 animate-pulse rounded-full bg-slate-100" />
            </div>
          </div>
        ) : profile ? (
          <div className="flex items-center gap-3 text-sm text-slate-700">
            <Link href="/dashboard" className="flex min-w-0 items-center gap-3 rounded-full px-2 py-1 transition hover:bg-slate-50">
              {profile.avatarUrl ? (
                <img alt={profile.nickname} className="h-10 w-10 rounded-full object-cover ring-1 ring-slate-200" src={profile.avatarUrl} />
              ) : (
                <div className="grid h-10 w-10 place-items-center rounded-full bg-rose-600 text-sm font-black text-white ring-1 ring-rose-100">
                  {userInitial}
                </div>
              )}
              <div className="min-w-0 text-right">
                <p className="max-w-36 truncate text-sm font-semibold text-slate-900">{profile.nickname}</p>
                <p className="max-w-36 truncate text-xs font-medium text-slate-400">{profile.account ?? "创作者账号"}</p>
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
          <Link href="/login" className="inline-flex h-9 items-center gap-2 rounded-full bg-rose-600 px-4 text-sm font-bold text-white transition hover:bg-rose-700">
            <UserRound className="h-4 w-4" />
            登录 / 注册
          </Link>
        )}
      </div>
    </header>
  );
}
