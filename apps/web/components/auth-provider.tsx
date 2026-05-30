"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { UserProfileSummary } from "@aicp/shared";
import { getCurrentUser } from "../lib/api";

type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  profile: UserProfileSummary | null;
  status: AuthStatus;
  setSession: (profile: UserProfileSummary) => void;
  clearSession: () => void;
  refreshSession: () => Promise<UserProfileSummary | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [profile, setProfile] = useState<UserProfileSummary | null>(null);
  const [status, setStatus] = useState<AuthStatus>(pathname.startsWith("/login") ? "anonymous" : "loading");

  useEffect(() => {
    let cancelled = false;

    async function syncSession() {
      if (pathname.startsWith("/login")) {
        if (!cancelled) {
          setProfile(null);
          setStatus("anonymous");
        }
        return;
      }

      if (status === "authenticated" && profile) {
        return;
      }

      if (!cancelled) {
        setStatus("loading");
      }

      try {
        const currentUser = await getCurrentUser();
        if (!cancelled) {
          setProfile(currentUser);
          setStatus("authenticated");
        }
      } catch {
        if (!cancelled) {
          setProfile(null);
          setStatus("anonymous");
        }
      }
    }

    void syncSession();

    return () => {
      cancelled = true;
    };
  }, [pathname, profile, status]);

  const value = useMemo<AuthContextValue>(
    () => ({
      profile,
      status,
      setSession: (nextProfile) => {
        setProfile(nextProfile);
        setStatus("authenticated");
      },
      clearSession: () => {
        setProfile(null);
        setStatus("anonymous");
      },
      refreshSession: async () => {
        try {
          const currentUser = await getCurrentUser();
          setProfile(currentUser);
          setStatus("authenticated");
          return currentUser;
        } catch {
          setProfile(null);
          setStatus("anonymous");
          return null;
        }
      }
    }),
    [profile, status]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
