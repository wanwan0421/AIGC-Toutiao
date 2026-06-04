"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "./auth-provider";
import { Icons } from "./icons";

const navItems = [
  { href: "/dashboard", label: "首页", icon: <Icons.Grid className="h-5 w-5" /> },
  { href: "/editor", label: "创作中心", icon: <Icons.PenTool className="h-5 w-5" /> },
  { href: "/content", label: "作品管理", icon: <Icons.Book className="h-5 w-5" /> },
  { href: "/analytics", label: "数据中心", icon: <Icons.Chart className="h-5 w-5" /> },
  { href: "/prompts", label: "Prompt 管理", icon: <Icons.Sparkles className="h-5 w-5" /> },
  { href: "/growth", label: "成长指南", icon: <Icons.Compass className="h-5 w-5" /> },
];

export function Sidebar() {
  const pathname = usePathname();
  const { status } = useAuth();
  const isLogin = pathname === "/login";
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (pathname.startsWith("/editor")) {
      setCollapsed(true);
      return;
    }
    setCollapsed(window.localStorage.getItem("aicp:sidebar-collapsed") === "1");
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem("aicp:sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }

  if (isLogin || status !== "authenticated") return null;

  return (
    <aside className={`hidden h-full shrink-0 flex-col border-r border-slate-100 bg-white transition-all md:flex ${collapsed ? "w-20" : "w-64"}`}>
      <div className="px-4 pt-4">
        <Link
          href="/editor"
          title="发布作品"
          className={`flex h-12 items-center justify-center gap-2 rounded-full bg-[#ff3b30] text-base font-semibold text-white shadow-sm transition hover:bg-[#e6352b] ${collapsed ? "px-0" : "px-5"}`}
        >
          <Icons.Plus className="h-4 w-4" />
          {collapsed ? null : <span>发布作品</span>}
        </Link>
      </div>

      <nav className="mt-5 flex-1 space-y-2 overflow-y-auto px-4">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex items-center rounded-2xl px-4 py-3 text-base transition-all ${
                collapsed ? "justify-center" : "gap-3"
              } ${active ? "bg-[#fff3f5] font-semibold text-[#ff3b30]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"}`}
            >
              <span className={active ? "text-[#ff3b30]" : "text-slate-400"}>{item.icon}</span>
              {collapsed ? null : <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={`border-t border-slate-100 p-4 ${collapsed ? "flex justify-center" : "flex justify-end"}`}>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="grid size-10 place-items-center rounded-full text-slate-400 transition hover:bg-slate-50 hover:text-[#ff3b30]"
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
