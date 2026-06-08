import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PenLine } from "lucide-react";
import { getGrowthGuide, growthGuides } from "../guides";

export function generateStaticParams() {
  return growthGuides.map((guide) => ({ slug: guide.slug }));
}

export default function GrowthGuideDetailPage({ params }: { params: { slug: string } }) {
  const guide = getGrowthGuide(params.slug);
  if (!guide) notFound();

  return (
    <article className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
      <Link href="/growth" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-rose-600">
        <ArrowLeft className="h-4 w-4" />
        返回成长指南
      </Link>

      <header className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-600">{guide.category}</span>
          <span className="text-xs font-bold text-slate-400">{guide.readTime}</span>
        </div>
        <h1 className="m-0 text-3xl font-black leading-tight text-slate-950">{guide.title}</h1>
        <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600">{guide.summary}</p>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <div className="grid gap-7">
            {guide.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="m-0 text-xl font-black text-slate-950">{section.heading}</h2>
                <p className="mt-3 text-base leading-9 text-slate-600">{section.body}</p>
              </section>
            ))}
          </div>
        </main>

        <aside className="grid content-start gap-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-base font-black text-slate-950">行动清单</h2>
            <div className="mt-4 grid gap-3">
              {guide.points.map((point) => (
                <div key={point} className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-600">
                  {point}
                </div>
              ))}
            </div>
          </section>

          <Link
            href="/editor"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#ff3b30] px-5 text-sm font-bold text-white shadow-sm transition hover:bg-[#e6352b]"
          >
            <PenLine className="h-4 w-4" />
            开始创作
          </Link>
        </aside>
      </div>
    </article>
  );
}
