"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "./icons";

const navItems = [
  { href: "/dashboard", label: "首页", icon: <Icons.Grid className="w-5 h-5" /> },
  { href: "/editor", label: "创作画布", icon: <Icons.PenTool className="w-5 h-5" /> },
  { href: "/content", label: "作品管理", icon: <Icons.Book className="w-5 h-5" /> },
  { href: "/analytics", label: "数据中心", icon: <Icons.Chart className="w-5 h-5" /> },
  { href: "/growth", label: "成长指南", icon: <Icons.Compass className="w-5 h-5" /> },
];

export function Sidebar() {
  const pathname = usePathname();
  const isEditor = pathname === "/editor";

  if (isEditor) {
    return (
      <aside className="w-[64px] h-screen bg-[#0E121B] border-r border-slate-800 flex flex-col shrink-0 hidden md:flex transition-all">
        <div className="p-4 flex justify-center">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-black text-sm tracking-tighter">
            AT
          </div>
        </div>
        <nav className="flex-1 px-2 space-y-3 mt-6">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex justify-center p-2.5 rounded-xl transition-all ${pathname === item.href ? "bg-white/10 text-white" : "text-slate-500 hover:bg-white/5 hover:text-slate-300"}`}
            >
              {item.icon}
            </Link>
          ))}
        </nav>
      </aside>
    );
  }

  return (
    <aside className="w-[260px] h-screen bg-[#FAFAFA] border-r border-[#EAEAEA] flex flex-col shrink-0 hidden md:flex transition-all">
      <div className="p-7">
        <h1 className="text-xl font-black text-slate-900 tracking-tight">
          今日头条<span className="text-blue-600 font-bold opacity-90">创作服务平台</span>
        </h1>
      </div>

      <nav className="flex-1 px-5 space-y-1.5 overflow-y-auto mt-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${pathname === item.href ? "bg-white border border-[#E2E4E9] shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"}`}
          >
            <span className={`transition-colors ${pathname === item.href ? "text-blue-600" : "text-slate-400"}`}>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="p-5 border-t border-[#EAEAEA]">
        <div className="flex items-center gap-3.5 px-3 py-2.5 rounded-xl hover:bg-white hover:shadow-sm hover:border hover:border-[#E2E4E9] border border-transparent cursor-pointer transition-all">
          <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs">
            A
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">Creator</p>
            <p className="text-xs text-slate-500 truncate">Lv.4 Pro</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

