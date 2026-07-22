import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, BookOpen, Flame, Hash, Loader2, PenTool, TrendingUp } from "lucide-react";
import type { ContentSummary, OfficialTopicSummary } from "@aicp/shared";
import { getOfficialTopics, getRankings } from "../lib/api";

export const dynamic = "force-dynamic";

type HomeDataPromises = {
  featuredPromise: ReturnType<typeof getRankings>;
  qualityPromise: ReturnType<typeof getRankings>;
  hotPromise: ReturnType<typeof getRankings>;
  topicsPromise: ReturnType<typeof getOfficialTopics>;
};

function compactNumber(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString();
}

function publishedLabel(content: ContentSummary) {
  const value = content.publishedAt ?? content.updatedAt;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function mergeUnique(items: ContentSummary[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export default function HomePage() {
  const dataPromises: HomeDataPromises = {
    featuredPromise: getRankings({ type: "viral", limit: 8 }, "no-store"),
    qualityPromise: getRankings({ type: "recommended", limit: 8 }, "no-store"),
    hotPromise: getRankings({ type: "hot", limit: 6 }, "no-store"),
    topicsPromise: getOfficialTopics({ limit: 10 }, "no-store"),
  };

  return (
    <section className="w-full bg-[#fbfaf7] text-slate-950">
      <Suspense fallback={<HomeHeroFallback />}>
        <HomeHero
          featuredPromise={dataPromises.featuredPromise}
          hotPromise={dataPromises.hotPromise}
          topicsPromise={dataPromises.topicsPromise}
        />
      </Suspense>

      <Suspense fallback={<HomeFeedFallback />}>
        <HomeFeed {...dataPromises} />
      </Suspense>
    </section>
  );
}

async function HomeHero({
  featuredPromise,
  hotPromise,
  topicsPromise,
}: Pick<HomeDataPromises, "featuredPromise" | "hotPromise" | "topicsPromise">) {
  try {
    const [featuredResponse, hotResponse, topicsResponse] = await Promise.all([
      featuredPromise,
      hotPromise,
      topicsPromise,
    ]);
    const hero = featuredResponse.items[0];
    const hotItems = hotResponse.items.length ? hotResponse.items : featuredResponse.items.slice(0, 6);

    return (
      <div className="border-b border-slate-200 bg-[#f6efe3]">
        <div className="mx-auto w-full max-w-350 px-4 py-6 sm:px-6 lg:px-8">
          {hero ? (
            <MagazineCover hero={hero} topics={topicsResponse.items.slice(0, 6)} hotItems={hotItems.slice(0, 3)} />
          ) : (
            <EmptyPanel title="暂无推荐内容" description="发布后的公开内容会出现在这里。" />
          )}
        </div>
      </div>
    );
  } catch (error) {
    console.error("Failed to render the home hero", error);
    return (
      <div className="border-b border-slate-200 bg-[#f6efe3]">
        <HomeSectionError section="首屏内容" />
      </div>
    );
  }
}

async function HomeFeed({ featuredPromise, qualityPromise, hotPromise, topicsPromise }: HomeDataPromises) {
  try {
    const [featuredResponse, qualityResponse, hotResponse, topicsResponse] = await Promise.all([
      featuredPromise,
      qualityPromise,
      hotPromise,
      topicsPromise,
    ]);
    const hero = featuredResponse.items[0];
    const spotlight = featuredResponse.items.slice(1, 5);
    const feedItems = mergeUnique([...qualityResponse.items, ...featuredResponse.items])
      .filter((item) => item.id !== hero?.id)
      .slice(0, 8);
    const hotItems = hotResponse.items.length ? hotResponse.items : featuredResponse.items.slice(0, 6);

    return (
      <div className="mx-auto grid w-full max-w-350 gap-8 px-4 py-8 sm:px-6 lg:px-8">
        {spotlight.length ? (
          <section className="grid gap-4">
            <SectionTitle eyebrow="精选" title="像翻杂志一样浏览" href="/rankings" />
            <div className="grid grid-cols-12 gap-4">
              {spotlight.map((content, index) => (
                <SpotlightCard content={content} featured={index === 0} key={content.id} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6 max-lg:grid-cols-1">
          <main className="grid gap-4">
            <SectionTitle eyebrow="新鲜" title="继续读下去" href="/rankings" />
            <div className="grid gap-3">
              {feedItems.map((content) => (
                <FeedArticle content={content} key={content.id} />
              ))}
            </div>
          </main>

          <aside className="grid gap-4 lg:sticky lg:top-20">
            <HotRail items={hotItems.slice(0, 6)} />
            <TopicPanel topics={topicsResponse.items.slice(0, 6)} />
          </aside>
        </section>
      </div>
    );
  } catch (error) {
    console.error("Failed to render the home feed", error);
    return <HomeSectionError section="推荐内容" />;
  }
}

function MagazineCover({ hero, topics, hotItems }: { hero: ContentSummary; topics: OfficialTopicSummary[]; hotItems: ContentSummary[] }) {
  return (
    <section className="grid min-h-[calc(100svh-112px)] items-center gap-6 py-4 lg:grid-cols-[minmax(0,0.94fr)_minmax(360px,1.06fr)]">
      <div className="grid gap-6">
        <h1 className="max-w-3xl text-5xl font-black leading-none tracking-normal text-slate-950 max-sm:text-4xl">今天值得点开的内容</h1>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/content/${hero.id}`}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-black text-white transition hover:bg-slate-800"
          >
            开始阅读
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/studio/editor"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-rose-600 px-5 text-sm font-black text-white transition hover:bg-rose-700"
          >
            <PenTool className="h-4 w-4" />
            开始创作
          </Link>
        </div>

        {topics.length ? (
          <div className="flex max-w-3xl flex-wrap gap-2">
            {topics.map((topic) => (
              <Link
                href={`/topics/${encodeURIComponent(topic.title)}`}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-white/70 px-3 text-sm font-bold text-slate-700 ring-1 ring-slate-200 transition hover:text-rose-700 hover:ring-rose-200"
                key={topic.id}
              >
                <Hash className="h-3.5 w-3.5 text-rose-600" />
                {topic.title}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
        <Link href={`/content/${hero.id}`} className="group relative min-h-[460px] overflow-hidden rounded-lg bg-slate-900 shadow-2xl shadow-slate-900/20 max-sm:min-h-[360px]">
          <ArticleCover content={hero} className="absolute inset-0 h-full" />
          <div className="absolute inset-0 bg-linear-to-t from-slate-950/88 via-slate-950/22 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 grid gap-4 p-6 text-white">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex h-7 items-center gap-1 rounded-lg bg-white/16 px-3 text-xs font-black backdrop-blur">
                <Flame className="h-3.5 w-3.5" />
                主推
              </span>
              <span className="inline-flex h-7 items-center rounded-lg bg-white/16 px-3 text-xs font-black backdrop-blur">{compactNumber(hero.heatScore)} 热度</span>
            </div>
            <div>
              <h2 className="text-3xl font-black leading-tight max-sm:text-2xl">{hero.title}</h2>
              <p className="mt-3 line-clamp-2 text-sm leading-7 text-white/78">{hero.excerpt}</p>
            </div>
          </div>
        </Link>

        <div className="grid gap-3 max-lg:grid-cols-3 max-sm:grid-cols-1">
          {hotItems.map((item, index) => (
            <Link
              href={`/content/${item.id}`}
              key={item.id}
              className="grid min-h-35 content-between rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-rose-200"
            >
              <span className="text-xs font-black text-rose-600">0{index + 1}</span>
              <span className="line-clamp-3 text-sm font-black leading-6 text-slate-950">{item.title}</span>
              <span className="text-xs font-bold text-slate-400">{compactNumber(item.viewCount)} 阅读</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionTitle({ eyebrow, title, href }: { eyebrow: string; title: string; href: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="mt-1 text-2xl font-black text-rose-600">{eyebrow}</h2>
      </div>
      <Link href={href} className="inline-flex items-center gap-1 text-sm font-black text-slate-600 transition hover:text-rose-700">
        查看更多
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function SpotlightCard({ content, featured }: { content: ContentSummary; featured: boolean }) {
  return (
    <article className={`${featured ? "col-span-6 row-span-2 max-lg:col-span-12" : "col-span-3 max-lg:col-span-6 max-sm:col-span-12"} overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md`}>
      <Link href={`/content/${content.id}`} className={featured ? "block h-82 bg-slate-100" : "block h-42 bg-slate-100"}>
        <ArticleCover content={content} className={featured ? "h-82" : "h-42"} />
      </Link>
      <div className="grid gap-3 p-4">
        <p className="flex items-center gap-2 text-xs font-bold text-slate-400">
          <BookOpen className="h-3.5 w-3.5" />
          <span>{publishedLabel(content)}</span>
          <span>{compactNumber(content.viewCount)} 阅读</span>
        </p>
        <h3 className={`${featured ? "text-2xl" : "text-base"} m-0 line-clamp-2 font-black leading-snug text-slate-950`}>
          <Link href={`/content/${content.id}`}>{content.title}</Link>
        </h3>
        <p className="m-0 line-clamp-2 text-sm leading-6 text-slate-500">{content.excerpt}</p>
      </div>
    </article>
  );
}

function FeedArticle({ content }: { content: ContentSummary }) {
  return (
    <article className="grid grid-cols-[minmax(0,1fr)_132px] gap-4 border-b border-slate-200 bg-transparent py-4 max-sm:grid-cols-1">
      <div className="min-w-0">
        <h3 className="m-0 text-xl font-black leading-snug text-slate-950">
          <Link href={`/content/${content.id}`} className="transition hover:text-rose-700">
            {content.title}
          </Link>
        </h3>
        <p className="mt-2 line-clamp-2 text-sm leading-7 text-slate-500">{content.excerpt}</p>
        <p className="mt-2 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-400">
          <span>{content.author.nickname}</span>
          <span>{publishedLabel(content)}</span>
          <span>{compactNumber(content.heatScore)} 热度</span>
        </p>
      </div>
      <Link href={`/content/${content.id}`} className="block h-24 overflow-hidden rounded-lg bg-slate-100 max-sm:h-40">
        <ArticleCover content={content} className="h-24 max-sm:h-40" />
      </Link>
    </article>
  );
}

function HotRail({ items }: { items: ContentSummary[] }) {
  return (
    <section className="rounded-lg bg-slate-950 p-5 text-white">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-black">正在升温</h2>
        <TrendingUp className="h-5 w-5 text-amber-300" />
      </div>
      <div className="mt-4 grid gap-1">
        {items.map((content, index) => (
          <Link href={`/content/${content.id}`} key={content.id} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 rounded-lg py-3 transition hover:bg-white/8">
            <span className="text-sm font-black text-amber-300">{index + 1}</span>
            <span className="min-w-0">
              <span className="block line-clamp-2 text-sm font-black leading-6">{content.title}</span>
              <span className="mt-1 block text-xs font-bold text-white/45">{compactNumber(content.heatScore)} 热度</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function TopicPanel({ topics }: { topics: OfficialTopicSummary[] }) {
  if (!topics.length) return null;

  return (
    <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-black text-slate-950">话题入口</h2>
        <Hash className="h-5 w-5 text-rose-600" />
      </div>
      <div className="mt-4 grid gap-3">
        {topics.map((topic) => (
          <Link href={`/topics/${encodeURIComponent(topic.title)}`} className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 rounded-lg bg-slate-50 p-3 transition hover:bg-rose-50" key={topic.id}>
            {topic.coverUrl ? (
              <img src={topic.coverUrl} alt="" className="h-11 w-11 rounded-lg object-cover" />
            ) : (
              <span className="grid h-11 w-11 place-items-center rounded-lg bg-white text-rose-600">
                <Hash className="h-5 w-5" />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-slate-900">#{topic.title}</span>
              <span className="mt-1 block text-xs font-bold text-slate-400">
                {topic.contentCount} 篇 · {compactNumber(topic.heatScore)} 热度
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ArticleCover({ content, className }: { content: ContentSummary; className: string }) {
  if (content.coverUrl) {
    return <img src={content.coverUrl} alt="" className={`${className} w-full object-cover`} />;
  }

  return (
    <div className={`${className} grid w-full place-items-center bg-linear-to-br from-amber-100 via-rose-100 to-sky-100`}>
      <span className="max-w-52 px-4 text-center text-sm font-black leading-6 text-slate-800">{content.title}</span>
    </div>
  );
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-96 place-items-center rounded-lg border border-dashed border-slate-300 bg-white/70 p-8 text-center">
      <div>
        <p className="text-lg font-black text-slate-900">{title}</p>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="grid min-h-[calc(100svh-112px)] items-center gap-6 py-4 lg:grid-cols-[minmax(0,0.94fr)_minmax(360px,1.06fr)]">
      <div className="grid gap-5">
        <div className="h-5 w-28 animate-pulse rounded-lg bg-white/70" />
        <div className="h-28 max-w-2xl animate-pulse rounded-lg bg-white/70" />
        <div className="h-12 max-w-xl animate-pulse rounded-lg bg-white/70" />
        <div className="flex gap-3">
          <div className="h-11 w-28 animate-pulse rounded-lg bg-white/70" />
          <div className="h-11 w-28 animate-pulse rounded-lg bg-white/70" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
        <div className="grid min-h-[460px] place-items-center rounded-lg bg-white/70 text-sm font-semibold text-slate-400">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载阅读广场
          </span>
        </div>
        <div className="grid gap-3 max-lg:grid-cols-3 max-sm:grid-cols-1">
          <div className="min-h-35 animate-pulse rounded-lg bg-white/70" />
          <div className="min-h-35 animate-pulse rounded-lg bg-white/70" />
          <div className="min-h-35 animate-pulse rounded-lg bg-white/70" />
        </div>
      </div>
    </div>
  );
}

function HomeHeroFallback() {
  return (
    <div className="border-b border-slate-200 bg-[#f6efe3]">
      <div className="mx-auto w-full max-w-350 px-4 py-6 sm:px-6 lg:px-8">
        <HomeSkeleton />
      </div>
    </div>
  );
}

function HomeFeedFallback() {
  return (
    <div className="mx-auto grid w-full max-w-350 gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-6 h-82 animate-pulse rounded-lg bg-white shadow-sm ring-1 ring-slate-200 max-lg:col-span-12" />
        <div className="col-span-3 h-58 animate-pulse rounded-lg bg-white shadow-sm ring-1 ring-slate-200 max-lg:col-span-6 max-sm:col-span-12" />
        <div className="col-span-3 h-58 animate-pulse rounded-lg bg-white shadow-sm ring-1 ring-slate-200 max-lg:col-span-6 max-sm:col-span-12" />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-6 max-lg:grid-cols-1">
        <div className="grid gap-3">
          <div className="h-28 animate-pulse rounded-lg bg-white ring-1 ring-slate-200" />
          <div className="h-28 animate-pulse rounded-lg bg-white ring-1 ring-slate-200" />
          <div className="h-28 animate-pulse rounded-lg bg-white ring-1 ring-slate-200" />
        </div>
        <div className="h-80 animate-pulse rounded-lg bg-slate-900" />
      </div>
    </div>
  );
}

function HomeSectionError({ section }: { section: string }) {
  return (
    <div className="mx-auto w-full max-w-350 px-4 py-8 sm:px-6 lg:px-8">
      <div className="rounded-lg border border-rose-200 bg-white px-5 py-4 text-sm font-semibold text-rose-700 shadow-sm">
        {section}暂时加载失败，请稍后刷新重试。
      </div>
    </div>
  );
}
