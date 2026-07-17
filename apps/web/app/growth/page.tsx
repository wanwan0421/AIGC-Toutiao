import Link from "next/link";
import { ArrowRight, BookOpen, Sparkles } from "lucide-react";
import { growthGuides } from "./guides";

export default function GrowthGuidePage() {
  return (
    <div className="mx-auto min-h-full max-w-350 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 text-2xl font-semibold tracking-normal text-slate-950">成长指南</h1>
        <Link
          href="/studio/editor"
          className="flex items-center gap-2 rounded-full bg-[#ff2442] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e6352b]"
        >
          <Sparkles className="h-4 w-4" />
          开始创作
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {growthGuides.map((guide) => (
          <Link
            key={guide.slug}
            href={`/studio/growth/${guide.slug}`}
            className="group flex min-h-72 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-rose-100 hover:shadow-md"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-600">{guide.category}</span>
              <span className="text-xs font-bold text-slate-400">{guide.readTime}</span>
            </div>
            <div className="mb-4 grid size-11 place-items-center rounded-2xl bg-slate-950 text-white">
              <BookOpen className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-black leading-7 text-slate-950">{guide.title}</h2>
            <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-500">{guide.summary}</p>
            <span className="mt-auto inline-flex items-center gap-1 pt-5 text-sm font-black text-rose-600">
              阅读指南 <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
