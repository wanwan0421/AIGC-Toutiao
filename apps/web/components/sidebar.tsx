"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./auth-provider";
import { Icons } from "./icons";

const navItems = [
  { href: "/dashboard", label: "首页", icon: <Icons.Grid className="h-5 w-5" /> },
  { href: "/editor", label: "创作中心", icon: <Icons.PenTool className="h-5 w-5" /> },
  { href: "/content", label: "作品管理", icon: <Icons.Book className="h-5 w-5" /> },
  { href: "/analytics", label: "数据中心", icon: <Icons.Chart className="h-5 w-5" /> },
  { href: "/growth", label: "成长指南", icon: <Icons.Compass className="h-5 w-5" /> }
];

export function Sidebar() {
  const pathname = usePathname();
  const { status } = useAuth();
  const isEditor = pathname === "/editor";
  const isLogin = pathname === "/login";

  if (isLogin || status !== "authenticated") return null;

  if (isEditor) {
    return (
      <aside className="hidden h-screen w-16 shrink-0 flex-col transition-all md:flex">
        <nav className="mt-6 flex-1 space-y-3 px-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex justify-center rounded-xl p-2.5 transition-all ${
                pathname === item.href ? "bg-white/10 text-[#ff3b30]" : "text-slate-500 hover:bg-white/5 hover:text-slate-800"
              }`}
            >
              {item.icon}
            </Link>
          ))}
        </nav>
      </aside>
    );
  }

  return (
    <aside className="hidden h-screen w-63 shrink-0 flex-col transition-all md:flex">
      <div className="px-5 pt-4">
        <Link
          href="/editor"
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#ff3b30] text-[16px] font-semibold text-white shadow-sm transition hover:bg-[#e6352b]"
        >
          <Icons.Plus className="h-4 w-4" />
          发布作品
        </Link>
      </div>

      <nav className="mt-5 flex-1 space-y-2 overflow-y-auto px-4">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-[16px] transition-all ${
                active ? "bg-[#fff3f5] font-semibold text-[#ff3b30]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <span className={active ? "text-[#ff3b30]" : "text-slate-400"}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 p-5" />
    </aside>
  );
}
