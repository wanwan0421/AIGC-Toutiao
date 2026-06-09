"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  ContentStatus,
  type ContentSummary,
  type DashboardAnalyticsResponse,
  type DashboardMetric,
  type OfficialTopicSummary,
  type UserProfileSummary,
} from "@aicp/shared";
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  ChevronRight,
  Flame,
  Hash,
  ImagePlus,
  Loader2,
  PenLine,
  UserRound,
  Wand2,
  X,
} from "lucide-react";
import {
  getContents,
  getDashboardAnalytics,
  getOfficialTopics,
  getRankings,
  sendContactVerificationCode,
  updateUserProfile
} from "../../lib/api";
import { useAuth } from "../../components/auth-provider";
import { OptimizedImage } from "../../components/optimized-image";

const statusLabel: Record<ContentStatus, string> = {
  [ContentStatus.Draft]: "草稿",
  [ContentStatus.PendingReview]: "审核中",
  [ContentStatus.Approved]: "待发布",
  [ContentStatus.Rejected]: "未通过",
  [ContentStatus.Scheduled]: "定时发布",
  [ContentStatus.Published]: "已发布",
  [ContentStatus.Updated]: "有更新",
  [ContentStatus.Offline]: "已下线",
};

function compactNumber(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString();
}

function formatDate(value?: string) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function buildTrendPoints(contents: ContentSummary[]) {
  const sorted = [...contents].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()).slice(-7);
  const max = Math.max(...sorted.map((item) => item.viewCount + item.likeCount * 3 + item.heatScore), 1);
  return sorted.map((item) => ({
    label: new Date(item.updatedAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }).replace(/\//g, "-"),
    value: Math.max(10, Math.round(((item.viewCount + item.likeCount * 3 + item.heatScore) / max) * 100)),
  }));
}

const AVATAR_CROP_SIZE = 260;
const AVATAR_OUTPUT_SIZE = 512;

type AvatarCropState = {
  source: string;
  width: number;
  height: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
};

type DataBoardRange = 7 | 30;

const dashboardMetricLabels: Record<DashboardMetric, string> = {
  view: "阅读量",
  click: "访问量",
  like: "点赞数",
  collect: "收藏数",
  comment: "评论数",
  heat: "热度",
};

const dashboardMetricOrder: DashboardMetric[] = ["view", "click", "like", "collect", "comment", "heat"];

function loadImageSize(source: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("图片读取失败"));
    image.src = source;
  });
}

function getCropDisplayMetrics(cropState: AvatarCropState) {
  const baseScale = Math.max(AVATAR_CROP_SIZE / cropState.width, AVATAR_CROP_SIZE / cropState.height);
  const displayScale = baseScale * cropState.zoom;
  const displayWidth = cropState.width * displayScale;
  const displayHeight = cropState.height * displayScale;
  const minOffsetX = (AVATAR_CROP_SIZE - displayWidth) / 2;
  const maxOffsetX = (displayWidth - AVATAR_CROP_SIZE) / 2;
  const minOffsetY = (AVATAR_CROP_SIZE - displayHeight) / 2;
  const maxOffsetY = (displayHeight - AVATAR_CROP_SIZE) / 2;

  return {
    displayScale,
    displayWidth,
    displayHeight,
    left: AVATAR_CROP_SIZE / 2 - displayWidth / 2 + cropState.offsetX,
    top: AVATAR_CROP_SIZE / 2 - displayHeight / 2 + cropState.offsetY,
    minOffsetX,
    maxOffsetX,
    minOffsetY,
    maxOffsetY,
  };
}

function clampAvatarCropOffset(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function cropAvatarImage(cropState: AvatarCropState) {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("图片裁剪失败"));
    image.src = cropState.source;
  });

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("无法创建裁剪画布");
  }

  const metrics = getCropDisplayMetrics(cropState);
  const sourceX = Math.max(0, Math.min(cropState.width - AVATAR_CROP_SIZE / metrics.displayScale, (-metrics.left) / metrics.displayScale));
  const sourceY = Math.max(0, Math.min(cropState.height - AVATAR_CROP_SIZE / metrics.displayScale, (-metrics.top) / metrics.displayScale));
  const sourceWidth = AVATAR_CROP_SIZE / metrics.displayScale;
  const sourceHeight = AVATAR_CROP_SIZE / metrics.displayScale;

  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  return canvas.toDataURL("image/png");
}

export default function DashboardPage() {
  const router = useRouter();
  const { profile: sessionProfile, status: authStatus, setSession } = useAuth();
  const [contents, setContents] = useState<ContentSummary[]>([]);
  const [rankings, setRankings] = useState<ContentSummary[]>([]);
  const [topicCards, setTopicCards] = useState<OfficialTopicSummary[]>([]);
  const [profile, setProfile] = useState<UserProfileSummary | null>(sessionProfile);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("正在加载创作数据...");
  const [profileOpen, setProfileOpen] = useState(false);
  const [dashboardRange, setDashboardRange] = useState<DataBoardRange>(7);
  const [dashboardMetric, setDashboardMetric] = useState<DashboardMetric>("view");
  const [dashboardData, setDashboardData] = useState<DashboardAnalyticsResponse | null>(null);

  async function loadDashboard() {
    setLoading(true);
    try {
      const [contentItems, rankingResponse, topicResponse, dashboardResponse] = await Promise.all([
        getContents(),
        getRankings({ type: "viral", limit: 20 }),
        getOfficialTopics(6),
        getDashboardAnalytics({ range: dashboardRange, metric: dashboardMetric }),
      ]);
      setContents(contentItems);
      setRankings(rankingResponse.items);
      setTopicCards(topicResponse.items);
      setDashboardData(dashboardResponse);
      setProfile(sessionProfile);
      setMessage(`已加载 ${contentItems.length} 篇作品`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "";
      if (errorMessage.includes("login required") || errorMessage.includes("session expired")) {
        router.push("/login");
        return;
      }
      setMessage(error instanceof Error ? `数据加载失败：${error.message}` : "数据加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, [sessionProfile, dashboardRange, dashboardMetric]);

  useEffect(() => {
    setProfile(sessionProfile);
  }, [sessionProfile]);

  const stats = useMemo(() => {
    const published = contents.filter((item) =>
      [ContentStatus.Published, ContentStatus.Updated, ContentStatus.Approved].includes(item.status)
    );
    const drafts = contents.filter((item) => item.status === ContentStatus.Draft);
    const pending = contents.filter((item) => item.status === ContentStatus.PendingReview);
    const totalViews = contents.reduce((sum, item) => sum + item.viewCount, 0);
    const totalLikes = contents.reduce((sum, item) => sum + item.likeCount, 0);
    const totalCollects = contents.reduce((sum, item) => sum + (item.collectCount ?? 0), 0);
    const totalHeat = contents.reduce((sum, item) => sum + item.heatScore, 0);
    const totalComments = contents.reduce((sum, item) => sum + (item.commentCount ?? 0), 0);
    const averageScore = contents.length ? contents.reduce((sum, item) => sum + item.qualityScore, 0) / contents.length : 0;

    return {
      published,
      drafts,
      pending,
      totalViews,
      totalLikes,
      totalCollects,
      totalHeat,
      totalComments,
      averageScore,
      follows: profile?.followingCount ?? sessionProfile?.followingCount ?? 0,
      fans: profile?.followerCount ?? sessionProfile?.followerCount ?? 0,
    };
  }, [contents, profile?.followerCount, profile?.followingCount, sessionProfile?.followerCount, sessionProfile?.followingCount]);

  const loadingProfile = authStatus === "loading" || loading;
  const displayAccountId = useMemo(() => {
    return profile?.accountNo ? String(profile.accountNo) : "请先登录";
  }, [profile?.accountNo]);

  function LoadingStatSkeleton() {
    return <div className="mx-auto h-5 w-12 animate-pulse rounded-full bg-slate-200/80" />;
  }

  const latestWorks = useMemo(
    () =>
      [...contents]
        .sort((a, b) => new Date(b.createdAt ?? b.updatedAt).getTime() - new Date(a.createdAt ?? a.updatedAt).getTime())
        .slice(0, 4),
    [contents]
  );

  const primaryWork = dashboardData?.latestWork ?? latestWorks[0];
  const trendPoints = dashboardData?.trend ?? [];

  return (
    <div className="min-h-full text-slate-950">
      <main className="grid gap-5 px-6 py-5 md:px-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-5">
          <section className="grid gap-5 ">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <AvatarBlock profile={profile} loading={loadingProfile} />
                  <div className="min-w-0 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="truncate text-xl font-black">
                        {loadingProfile && !profile
                          ? "正在加载账号..."
                          : (profile?.nickname ?? "未登录")}
                      </h1>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                        <BadgeCheck className="h-3.5 w-3.5" />
                        账号状态正常
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm text-slate-500">
                        账号ID：
                        {loadingProfile && !profile
                          ? "加载中"
                          : displayAccountId}
                      </p>

                      <p className="text-sm text-slate-500">|</p>

                      <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
                        简介：
                        {loadingProfile && !profile
                          ? "正在加载当前登录用户信息..."
                          : profile?.bio ||
                            "还没有填写个人简介，可以在资料设置里补充创作领域、内容风格,让更多人发现你吧!"}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm text-slate-500">关注：</p>
                        {loadingProfile ? <LoadingStatSkeleton /> : <p className="text-sm font-semibold text-slate-800">{stats.follows}</p>}
                      </div>
                      <p className="text-sm text-slate-500">|</p>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm text-slate-500">粉丝：</p>
                        {loadingProfile ? <LoadingStatSkeleton /> : <p className="text-sm font-semibold text-slate-800">{stats.fans}</p>}
                      </div>
                      <p className="text-sm text-slate-500">|</p>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm text-slate-500">获赞：</p>
                        {loadingProfile ? <LoadingStatSkeleton /> : <p className="text-sm font-semibold text-slate-800">{stats.totalLikes}</p>}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setProfileOpen(true)}
                    disabled={!profile}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <UserRound className="h-4 w-4" />
                    修改资料
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">新的创作</h2>
                <p className="mt-1 text-sm text-slate-500">
                  进入 AI 协作创作中心，完成从构思到图文发布的流程
                </p>
              </div>
              <Link
                href="/editor"
                className="text-sm font-bold text-rose-600 hover:text-rose-700"
              >
                进入创作中心 <ChevronRight className="inline h-4 w-4" />
              </Link>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <CreationEntry
                href="/editor"
                icon={<PenLine className="h-5 w-5" />}
                title="发布文章"
                desc="长文、短图文、AI 辅助编辑"
                tone="rose"
              />
              <CreationEntry
                href="/editor?mode=image"
                icon={<ImagePlus className="h-5 w-5" />}
                title="图文草稿"
                desc="素材整理与图片资产生成"
                tone="blue"
              />
              <CreationEntry
                href="/editor?mode=ai"
                icon={<Wand2 className="h-5 w-5" />}
                title="AI 一键初稿"
                desc="主题、人群、风格到完整草稿"
                tone="amber"
              />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black">数据看板</h2>
              </div>
              <div className="flex rounded-full bg-slate-100 p-1">
                {([7, 30] as DataBoardRange[]).map((range) => (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setDashboardRange(range)}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                      dashboardRange === range ? "bg-white text-rose-600 shadow-sm" : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    近{range}日
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
              <LatestWorkCard work={primaryWork} />
              <div className="min-w-0 border-slate-100 lg:border-l lg:pl-7">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="border-b-2 border-rose-500 pb-2 text-sm font-black text-slate-950">笔记数据总览</div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                    当前指标：{dashboardMetricLabels[dashboardMetric]}
                  </span>
                </div>

                <TrendLineChart
                  metric={dashboardMetric}
                  label={dashboardMetricLabels[dashboardMetric]}
                  points={trendPoints.map((point) => ({ label: point.label, value: point[dashboardMetric] }))}
                />
                <div className="mt-5 grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                  {dashboardMetricOrder.map((metric) => {
                    const item = dashboardData?.metrics[metric];
                    return (
                      <DataBoardMetric
                        key={metric}
                        label={dashboardMetricLabels[metric]}
                        value={item?.total ?? 0}
                        delta={item?.delta ?? 0}
                        active={dashboardMetric === metric}
                        onClick={() => setDashboardMetric(metric)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-black">创作话题</h2>
                <span className="text-xs font-semibold text-slate-400">
                  官方推荐
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {topicCards.map((topic) => (
                  <Link
                    key={topic.id}
                    href={`/topics/${encodeURIComponent(topic.title)}`}
                    className="flex gap-3 rounded-xl bg-slate-50 p-3 transition hover:bg-rose-50"
                  >
                    {topic.coverUrl ? (
                      <OptimizedImage src={topic.coverUrl} alt="" width={56} height={56} priority={false} className="h-14 w-14" />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
                        <Hash className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="truncate text-sm font-black text-slate-800">
                          #{topic.title}
                        </h3>
                        <span className="shrink-0 text-xs font-bold text-rose-600">
                          {compactNumber(topic.heatScore)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                        {topic.description || `${topic.contentCount} 篇内容正在讨论`}
                      </p>
                    </div>
                  </Link>
                ))}
                {!topicCards.length && (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 sm:col-span-2">
                    热门话题正在整理中。
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-black">最新作品</h2>
                <Link
                  href="/content"
                  className="text-xs font-bold text-rose-600"
                >
                  管理全部
                </Link>
              </div>
              <div className="space-y-3">
                {latestWorks.map((work) => (
                  <LatestWorkRow key={work.id} work={work} />
                ))}
                {!latestWorks.length && (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                    还没有作品，先从创作中心发布第一篇。
                  </p>
                )}
              </div>
            </div>
          </section>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-black">
                <Flame className="h-5 w-5 text-rose-500" />
                热门榜单
              </h2>
              <Link
                href="/rankings"
                className="text-xs font-bold text-rose-600"
              >
                查看全部
              </Link>
            </div>
            <div className="space-y-2">
              {rankings.slice(0, 8).map((item, index) => (
                <Link
                  key={item.id}
                  href={`/content/${item.id}`}
                  className="flex gap-3 rounded-xl p-3 transition hover:bg-slate-50"
                >
                  <span
                    className={`mt-0.5 w-6 text-sm font-black ${index < 3 ? "text-rose-500" : "text-slate-400"}`}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 text-sm font-bold text-slate-800">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                      {compactNumber(item.heatScore)} 热度 ·{" "}
                      {compactNumber(item.viewCount)} 曝光
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black">创作成长任务</h2>
              <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600">
                本周
              </span>
            </div>
            <div className="mt-5 space-y-4">
              <ProgressLine
                label="发布进度"
                value={Math.min(stats.published.length * 22, 100)}
              />
              <ProgressLine
                label="互动进度"
                value={Math.min(Math.round(stats.totalLikes / 5), 100)}
              />
              <ProgressLine
                label="质量进度"
                value={Math.min(Math.round(stats.averageScore), 100)}
              />
            </div>
            <Link
              href="/growth"
              className="mt-5 flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 text-sm font-bold text-white transition hover:bg-rose-700"
            >
              查看成长指南 <ArrowRight className="h-4 w-4" />
            </Link>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black">平台通知</h2>
            <div className="mt-4 space-y-3">
              <NoticeRow title="创作助手已支持真实图片资产生成" date="今日" />
              <NoticeRow title="发布内容更新后可重新进入审核链路" date="本周" />
              <NoticeRow title="建议完善个人资料以提升账号可信度" date="本周" />
            </div>
          </section>
        </aside>
      </main>

      {profileOpen && profile && (
        <ProfileDialog
          profile={profile}
          onClose={() => setProfileOpen(false)}
          onSaved={(nextProfile) => {
            setProfile(nextProfile);
            setSession(nextProfile);
            setProfileOpen(false);
            setMessage("个人资料已保存");
          }}
        />
      )}
    </div>
  );
}

function AvatarBlock({ profile, loading }: { profile: UserProfileSummary | null; loading: boolean }) {
  if (loading && !profile) {
    return <div className="h-18 w-18 animate-pulse rounded-full bg-slate-100 ring-4 ring-rose-50" />;
  }

  const initial = profile?.nickname?.slice(0, 1).toUpperCase() || "C";

  if (profile?.avatarUrl) {
    return <div className="h-18 w-18 overflow-hidden rounded-full"><OptimizedImage src={profile.avatarUrl} alt={profile.nickname} width={72} height={72} priority={false} /></div>;
  }

  return (
    <div className="flex h-18 w-18 items-center justify-center rounded-full bg-linear-to-br from-rose-500 to-orange-400 text-xl font-black text-white ring-4 ring-rose-50">
      {initial}
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-lg font-black text-slate-950">{compactNumber(value)}</div>
      <div className="mt-1 text-xs font-semibold text-slate-400">{label}</div>
    </div>
  );
}

function ProgressLine({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-bold">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-900">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-linear-to-r from-rose-500 to-orange-400" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function CreationEntry({
  href,
  icon,
  title,
  desc,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  tone: "rose" | "blue" | "amber";
}) {
  const toneClass = {
    rose: "bg-rose-50 text-rose-600 border-rose-100",
    blue: "bg-sky-50 text-sky-600 border-sky-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100",
  }[tone];

  return (
    <Link href={href} className={`group rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:shadow-md ${toneClass}`}>
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm">{icon}</div>
      <h3 className="text-base font-black text-slate-900">{title}</h3>
      <p className="mt-1 text-sm font-medium text-slate-500">{desc}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-xs font-black">
        开始 <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function LatestWorkCard({ work }: { work?: ContentSummary }) {
  if (!work) {
    return (
      <div className="flex h-full min-h-72 flex-col justify-between rounded-2xl bg-slate-100 p-5">
        <div>
          <p className="text-sm font-black text-slate-900">最新作品</p>
          <p className="mt-8 text-sm font-semibold text-slate-500">暂无作品数据</p>
        </div>
        <div className="rounded-xl bg-white/70 px-4 py-3 text-sm font-bold text-slate-400">发布后将展示阅读和点赞表现</div>
      </div>
    );
  }

  return (
    <Link href={`/content/${work.id}`} className="group block h-full min-h-72 overflow-hidden rounded-2xl bg-slate-950 text-white shadow-sm">
      <div className="relative h-full min-h-72 bg-slate-200">
        {work.coverUrl ? (
          <OptimizedImage src={work.coverUrl} alt="" width={480} height={320} priority={false} className="h-full w-full" />
        ) : (
          <div className="h-full bg-linear-to-br from-slate-700 via-slate-500 to-rose-400" />
        )}
        <div className="absolute inset-0 bg-linear-to-b from-slate-950/35 via-transparent to-slate-950/75" />
        <h3 className="absolute bottom-4 left-4 right-4 line-clamp-2 text-base font-black leading-6">{work.title}</h3>
      </div>
    </Link>
  );
}

function DashboardWorkRow({ work }: { work: ContentSummary }) {
  return (
    <Link href={`/content/${work.id}`} className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 transition hover:border-rose-100 hover:bg-rose-50/40 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center">
      <div className="h-18 overflow-hidden rounded-xl bg-slate-100">
        {work.coverUrl ? (
          <OptimizedImage src={work.coverUrl} alt="" width={144} height={72} priority={false} className="h-full w-full" />
        ) : (
          <div className="h-full w-full bg-linear-to-br from-rose-50 to-orange-50" />
        )}
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-black text-slate-900">{work.title}</h3>
        <p className="mt-1 line-clamp-1 text-xs text-slate-500">{work.excerpt}</p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-400 sm:justify-end">
        <span>阅读 {compactNumber(work.viewCount)}</span>
        <span>点赞 {compactNumber(work.likeCount)}</span>
        <span>{formatDate(work.createdAt ?? work.updatedAt)}</span>
      </div>
    </Link>
  );
}

function TrendLineChart({
  points,
  label,
}: {
  metric: DashboardMetric;
  label: string;
  points: Array<{ label: string; value: number }>;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartPoints = points.length
    ? points
    : Array.from({ length: 7 }, (_, index) => ({ label: `06-0${index + 1}`, value: index === 0 ? 36 : 24 }));
  const max = Math.max(...chartPoints.map((point) => point.value), 1);
  const coordinates = chartPoints.map((point, index) => {
    const x = chartPoints.length === 1 ? 0 : (index / (chartPoints.length - 1)) * 100;
    const y = 92 - (point.value / max) * 70;
    return { ...point, x, y };
  });
  const path = coordinates.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const areaPath = `${path} L 100 96 L 0 96 Z`;

  return (
    <div className="mt-4">
      <div className="relative h-32">
        {/* 1. SVG 专职负责画线和面积（移除 circle） */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-28 w-full overflow-visible"
        >
          <defs>
            <linearGradient id="dashboardTrendFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#4f7cff" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#4f7cff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#dashboardTrendFill)" />
          <path
            d={path}
            fill="none"
            stroke="#4f7cff"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.2"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1="0"
            x2="100"
            y1="96"
            y2="96"
            stroke="#e5e7eb"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* 2. 新增：用绝对定位的 HTML DIV 渲染完美的圆形点 */}
        <div className="absolute left-0 top-0 h-28 w-full pointer-events-none">
          {coordinates.map((point, index) => (
            <div
              key={`dot-${point.label}-${index}`}
              className="absolute rounded-full bg-[#4f7cff] transition-all duration-200"
              style={{
                left: `${point.x}%`,
                top: `${point.y}%`,
                // 模拟你原本 r={1.8} 和 hover 变大的效果
                width: hoverIndex === index ? "8px" : "5px",
                height: hoverIndex === index ? "8px" : "5px",
                // 使用 translate 确保圆点中心精确对齐坐标
                transform: "translate(-50%, -50%)",
              }}
            />
          ))}
        </div>

        {/* 3. 悬浮交互层保持不变 */}
        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: `repeat(${chartPoints.length}, minmax(0, 1fr))`,
          }}
        >
          {coordinates.map((point, index) => (
            <div
              key={point.label}
              className="relative h-full"
              onMouseEnter={() => setHoverIndex(index)}
              onMouseLeave={() => setHoverIndex(null)}
            >
              {hoverIndex === index ? (
                <div
                  className="absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-lg"
                  style={{ left: "50%" }}
                >
                  <div className="whitespace-nowrap text-slate-400">
                    {point.label}
                  </div>
                  <div className="mt-1 whitespace-nowrap">
                    {label}：{compactNumber(point.value)}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="relative mt-2 h-6 w-full">
        {coordinates.map((point, index) => {
          // 1. 动态计算间隔：假设大于15天就每隔 5 天显示一次刻度
          const tickInterval = chartPoints.length > 7 ? 5 : 1;

          // 2. 判断当前点是否需要渲染标签（必须显示第一个和最后一个，中间的按间隔显示）
          const isFirst = index === 0;
          const isLast = index === chartPoints.length - 1;
          const isTick = index % tickInterval === 0;

          // 如果不符合条件，直接不渲染该元素的 DOM
          if (!isFirst && !isLast && !isTick) return null;

          // 3. 边缘防溢出处理：确保首尾的文字不会超出图表容器被裁切
          let transform = "translateX(-50%)"; // 默认居中对齐该点
          if (isFirst)
            transform = "translateX(0)"; // 第一个点左对齐
          else if (isLast) transform = "translateX(-100%)"; // 最后一个点右对齐

          return (
            <span
              key={`x-axis-${point.label}`}
              className="absolute whitespace-nowrap text-xs font-semibold text-slate-400"
              style={{
                left: `${point.x}%`,
                transform,
              }}
            >
              {point.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function DataBoardMetric({
  label,
  value,
  delta,
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  delta: number;
  active?: boolean;
  onClick: () => void;
}) {
  const deltaClass = delta > 0 ? "text-rose-500" : delta < 0 ? "text-emerald-600" : "text-slate-400";
  const deltaText = delta > 0 ? `+${delta}` : String(delta);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${
        active ? "border-rose-200 bg-rose-50/70" : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
      }`}
    >
      <p className={`text-sm font-black ${active ? "text-rose-600" : "text-slate-950"}`}>{label}</p>
      <div className="mt-1 flex items-end gap-2">
        <span className="text-2xl font-black text-slate-950">{compactNumber(value)}</span>
        <span className="pb-1 text-xs font-semibold text-slate-400">
          环比 <span className={deltaClass}>{deltaText}</span>
        </span>
      </div>
    </button>
  );
}

function LatestWorkRow({ work }: { work: ContentSummary }) {
  return (
    <Link href={`/content/${work.id}`} className="flex items-center justify-between gap-3 rounded-xl p-3 transition hover:bg-slate-50">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-black text-slate-800">{work.title}</h3>
        <p className="mt-1 text-xs text-slate-400">{formatDate(work.updatedAt)} · {compactNumber(work.viewCount)} 曝光</p>
      </div>
      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">{statusLabel[work.status]}</span>
    </Link>
  );
}

function NoticeRow({ title, date }: { title: string; date: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
      <span className="text-sm font-bold text-slate-700">{title}</span>
      <span className="shrink-0 text-xs font-bold text-slate-400">{date}</span>
    </div>
  );
}

function ProfileDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile: UserProfileSummary;
  onClose: () => void;
  onSaved: (profile: UserProfileSummary) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cropDragRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const [nickname, setNickname] = useState(profile.nickname);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [cropState, setCropState] = useState<AvatarCropState | null>(null);
  const [cropSaving, setCropSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contactCode, setContactCode] = useState("");
  const [sendingContactCode, setSendingContactCode] = useState(false);
  const [contactCodeHint, setContactCodeHint] = useState("");
  const [error, setError] = useState("");

  const cropMetrics = useMemo(() => (cropState ? getCropDisplayMetrics(cropState) : null), [cropState]);
  const contactChanged = phone.trim() !== (profile.phone ?? "") || email.trim() !== (profile.email ?? "");
  const changedContact = email.trim() !== (profile.email ?? "") ? email.trim() : phone.trim();

  function updateCropState(next: AvatarCropState | null) {
    setCropState((current) => {
      if (!next) return null;
      const nextMetrics = getCropDisplayMetrics(next);
      return {
        ...next,
        offsetX: clampAvatarCropOffset(next.offsetX, nextMetrics.minOffsetX, nextMetrics.maxOffsetX),
        offsetY: clampAvatarCropOffset(next.offsetY, nextMetrics.minOffsetY, nextMetrics.maxOffsetY),
      };
    });
  }

  async function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件");
      return;
    }

    setCropSaving(true);
    try {
      const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
          } else {
            reject(new Error("头像读取失败"));
          }
        };
        reader.onerror = () => reject(new Error("头像读取失败"));
        reader.readAsDataURL(file);
      });
      const size = await loadImageSize(source);
      updateCropState({
        source,
        width: size.width,
        height: size.height,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
      });
      setError("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "头像读取失败");
    } finally {
      setCropSaving(false);
      event.target.value = "";
    }
  }

  function handleCropPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!cropState) return;
    cropDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      offsetX: cropState.offsetX,
      offsetY: cropState.offsetY,
    };
    (event.currentTarget as HTMLDivElement).setPointerCapture?.(event.pointerId);
  }

  async function confirmAvatarCrop() {
    if (!cropState) return;
    setCropSaving(true);
    try {
      const croppedAvatar = await cropAvatarImage(cropState);
      setAvatarUrl(croppedAvatar);
      setCropState(null);
      setError("");
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : "裁剪失败");
    } finally {
      setCropSaving(false);
    }
  }

  async function saveProfile() {
    setSaving(true);
    setError("");
    try {
      const nextProfile = await updateUserProfile({
        nickname,
        phone,
        email,
        contactVerificationCode: contactChanged ? contactCode : undefined,
        bio,
        avatarUrl,
      });
      onSaved(nextProfile);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function sendProfileContactCode() {
    if (!changedContact) {
      setError("请先填写新的手机号或邮箱");
      return;
    }

    setSendingContactCode(true);
    setError("");
    setContactCodeHint("");

    try {
      const result = await sendContactVerificationCode({ account: changedContact });
      setContactCodeHint(
        result.delivery === "console"
          ? result.verificationCode
            ? `本次验证码：${result.verificationCode}`
            : "验证码已生成"
          : "验证码已发送"
      );
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "验证码发送失败");
    } finally {
      setSendingContactCode(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black">修改个人信息</h2>
            <p className="mt-1 text-sm text-slate-500">昵称、联系方式、简介与头像会用于账号展示。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-5 flex items-center gap-4 rounded-2xl bg-slate-50 p-4">
          <div className="relative">
            {avatarUrl ? (
              <img src={avatarUrl} alt={nickname} className="h-20 w-20 rounded-full object-cover ring-4 ring-white" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-rose-600 text-2xl font-black text-white ring-4 ring-white">
                {nickname.slice(0, 1).toUpperCase() || "C"}
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 rounded-full bg-slate-950 p-2 text-white shadow-lg hover:bg-rose-600"
              title="上传头像"
            >
              <Camera className="h-4 w-4" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={(event) => void handleAvatarUpload(event)} className="hidden" />
          </div>
          <div>
            <p className="text-sm font-black text-slate-800">上传并编辑头像</p>
            {avatarUrl && (
              <button type="button" onClick={() => setAvatarUrl("")} className="mt-2 text-xs font-bold text-rose-600">
                移除头像
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ProfileField label="昵称" value={nickname} onChange={setNickname} placeholder="输入创作者昵称" />
          <ProfileField label="手机号" value={phone} onChange={setPhone} placeholder="用于账号资料展示" />
          <ProfileField label="邮箱" value={email} onChange={setEmail} placeholder="creator@example.com" />
          {contactChanged ? (
            <div className="grid gap-2 md:col-span-2">
              <span className="text-xs font-black text-slate-500">联系方式验证码</span>
              <div className="flex gap-3">
                <input
                  value={contactCode}
                  onChange={(event) => setContactCode(event.target.value)}
                  placeholder="修改手机号或邮箱时需要验证码"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-50"
                />
                <button
                  type="button"
                  onClick={() => void sendProfileContactCode()}
                  disabled={sendingContactCode || !changedContact}
                  className="h-11 shrink-0 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sendingContactCode ? "发送中..." : "获取验证码"}
                </button>
              </div>
              {contactCodeHint ? <p className="text-xs font-semibold text-emerald-600">{contactCodeHint}</p> : null}
            </div>
          ) : null}
          <label className="grid gap-1.5 md:col-span-2">
            <span className="text-xs font-black text-slate-500">个人简介</span>
            <textarea
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder="介绍账号定位、创作方向或内容风格"
              className="min-h-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-50"
            />
          </label>
        </div>

        {error && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200">
            取消
          </button>
          <button
            type="button"
            onClick={() => void saveProfile()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存资料
          </button>
        </div>
      </div>

      {cropState && cropMetrics && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-slate-950">裁剪头像</h3>
                <p className="mt-1 text-sm text-slate-500">拖动图片调整位置，缩放后确认裁剪为正方形。</p>
              </div>
              <button
                type="button"
                onClick={() => setCropState(null)}
                className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex justify-center">
              <div
                className="relative overflow-hidden rounded-3xl bg-slate-100"
                style={{ width: AVATAR_CROP_SIZE, height: AVATAR_CROP_SIZE }}
                onPointerDown={handleCropPointerDown}
                onPointerUp={() => {
                  cropDragRef.current = null;
                }}
                onPointerLeave={() => {
                  cropDragRef.current = null;
                }}
                onPointerMove={(event) => {
                  if (!cropDragRef.current || !cropState) return;
                  const nextX = cropDragRef.current.offsetX + (event.clientX - cropDragRef.current.startX);
                  const nextY = cropDragRef.current.offsetY + (event.clientY - cropDragRef.current.startY);
                  const nextMetrics = getCropDisplayMetrics(cropState);
                  setCropState({
                    ...cropState,
                    offsetX: clampAvatarCropOffset(nextX, nextMetrics.minOffsetX, nextMetrics.maxOffsetX),
                    offsetY: clampAvatarCropOffset(nextY, nextMetrics.minOffsetY, nextMetrics.maxOffsetY),
                  });
                }}
              >
                <img
                  src={cropState.source}
                  alt="待裁剪头像"
                  draggable={false}
                  className="absolute max-w-none select-none"
                  style={{
                    left: `${cropMetrics.left}px`,
                    top: `${cropMetrics.top}px`,
                    width: `${cropMetrics.displayWidth}px`,
                    height: `${cropMetrics.displayHeight}px`,
                  }}
                />
                <div className="pointer-events-none absolute inset-0 border border-white/70" />
                <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_9999px_rgba(15,23,42,0.12)]" />
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500">
                <span>缩放</span>
                <span>{cropState.zoom.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={cropState.zoom}
                onChange={(event) => {
                  const nextZoom = Number(event.target.value);
                  setCropState((current) => {
                    if (!current) return current;
                    const nextState = { ...current, zoom: nextZoom };
                    const nextMetrics = getCropDisplayMetrics(nextState);
                    return {
                      ...nextState,
                      offsetX: clampAvatarCropOffset(nextState.offsetX, nextMetrics.minOffsetX, nextMetrics.maxOffsetX),
                      offsetY: clampAvatarCropOffset(nextState.offsetY, nextMetrics.minOffsetY, nextMetrics.maxOffsetY),
                    };
                  });
                }}
                className="w-full accent-rose-600"
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCropState(null)}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200"
              >
                取消裁剪
              </button>
              <button
                type="button"
                onClick={() => void confirmAvatarCrop()}
                disabled={cropSaving}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {cropSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                确认裁剪
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-50"
      />
    </label>
  );
}
