"use client";

export function LoadingShell({
  title
}: {
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/95 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 rounded-full border-4 border-slate-200 border-t-rose-600 animate-spin" />
        <p className="text-sm font-semibold text-slate-600">{title}</p>
      </div>
    </div>
  );
}
