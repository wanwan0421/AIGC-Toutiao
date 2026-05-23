import Link from "next/link";

const links = [
  ["工作台", "/dashboard"],
  ["创作中心", "/editor"],
  ["分发榜单", "/rankings"],
  ["账号", "/login"]
] as const;

export function TopNav() {
  return (
    <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-slate-200/80 bg-white/95 px-7 backdrop-blur-md max-md:flex-col max-md:items-start max-md:gap-3 max-md:px-5 max-md:py-4">
      <Link className="flex items-center gap-2.5 font-extrabold text-app-ink" href="/dashboard">
        <span className="grid size-8 place-items-center rounded-lg bg-slate-800 text-xs text-white">AI</span>
        <span>创作服务平台</span>
      </Link>
      <div className="flex items-center gap-4 max-md:flex-wrap">
        <nav className="flex items-center gap-1 text-sm text-app-muted max-md:flex-wrap" aria-label="primary">
          {links.map(([label, href]) => (
            <Link className="rounded-lg px-3 py-2 hover:bg-app-brand-soft hover:text-app-brand" href={href} key={href}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex min-h-8 items-center gap-2 rounded-full border border-app-border bg-app-soft px-3 text-sm font-bold text-app-green">
          <span className="size-2 rounded-full bg-app-green" />
          AI 审核在线
        </div>
      </div>
    </header>
  );
}
