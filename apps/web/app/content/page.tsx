"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ContentStatus, type ContentSummary } from "@aicp/shared";
import { Icons } from "../../components/icons";
import { StatusBadge } from "../../components/status-badge";
import {
  approveContent,
  getContentDetail,
  getContents,
  offlineContent,
  publishContent,
  rewriteText,
  submitReview,
  updateContent,
} from "../../lib/api";

function formatUpdatedAt(value: string) {
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) {
    return "时间未知";
  }

  return updatedAt.toLocaleString("zh-CN", { hour12: false });
}

function formatPublishedAt(value?: string) {
  if (!value) return "暂未发布";
  return formatUpdatedAt(value);
}

function actionLabel(content: ContentSummary, busyId: string | null) {
  if (busyId === content.id) return "处理中...";
  if (content.status === ContentStatus.Rejected) return "一键合规改写";
  if (content.status === ContentStatus.Draft) return "提交审核";
  if (content.status === ContentStatus.PendingReview) return "通过审核";
  if (content.status === ContentStatus.Approved || content.status === ContentStatus.Updated) return "发布更新";
  if (content.status === ContentStatus.Published) return "下线";
  return "执行操作";
}

export default function ContentPage() {
  const searchParams = useSearchParams();
  const statusFilterValue = searchParams.get("status");
  const statusFilter = Object.values(ContentStatus).includes(statusFilterValue as ContentStatus)
    ? (statusFilterValue as ContentStatus)
    : null;

  const [contents, setContents] = useState<ContentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("正在加载作品...");

  const filteredContents = useMemo(
    () => (statusFilter !== null ? contents.filter((item) => item.status === statusFilter) : contents),
    [contents, statusFilter]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadContents() {
      try {
        const response = await getContents();
        if (!cancelled) {
          setContents(response);
          setMessage(`已加载 ${response.length} 条作品`);
        }
      } catch (loadError) {
        if (!cancelled) {
          setMessage(loadError instanceof Error ? `加载失败：${loadError.message}` : "加载失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadContents();

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshContents() {
    const latest = await getContents();
    setContents(latest);
  }

  async function handleLifecycleAction(content: ContentSummary) {
    setBusyId(content.id);

    try {
      if (content.status === ContentStatus.Rejected) {
        const detail = await getContentDetail(content.id);
        const rewritten = await rewriteText({
          title: detail.title,
          body: detail.body,
          reasons: ["降低夸张表达", "补充事实描述", "增强合规性"],
        });

        await updateContent(content.id, {
          title: rewritten.title,
          body: rewritten.body,
          tags: detail.tags,
        });

        setMessage(`已完成「${detail.title}」的合规改写`);
      } else if (content.status === ContentStatus.Draft) {
        const response = await submitReview(content.id);
        setMessage(
          response.audit.passed
            ? `草稿已提交审核，质量分 ${response.quality.total}`
            : `草稿审核未通过，质量分 ${response.quality.total}`
        );
      } else if (content.status === ContentStatus.PendingReview) {
        await approveContent(content.id);
        setMessage(`「${content.title}」已通过审核`);
      } else if (content.status === ContentStatus.Approved || content.status === ContentStatus.Updated) {
        await publishContent(content.id);
        setMessage(`「${content.title}」已发布`);
      } else if (content.status === ContentStatus.Published) {
        await offlineContent(content.id);
        setMessage(`「${content.title}」已下线`);
      }

      await refreshContents();
    } catch (actionError) {
      setMessage(actionError instanceof Error ? `操作失败：${actionError.message}` : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  const tabs = [
    { label: "全部作品", value: null },
    { label: "已发布", value: ContentStatus.Published },
    { label: "草稿箱", value: ContentStatus.Draft },
    { label: "审核中", value: ContentStatus.PendingReview },
    { label: "未通过", value: ContentStatus.Rejected },
  ];

  return (
    <section className="min-h-full mx-auto max-w-350 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">
            作品管理
          </h1>
        </div>
        <Link
          href="/editor"
          className="flex items-center gap-2 rounded-full bg-[#ff2442] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e91635]"
        >
          <Icons.Plus className="h-4 w-4" /> 发布新作品
        </Link>
      </header>

      <div className="mb-6 flex w-max max-w-full overflow-x-auto rounded-full bg-slate-100 p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={
              tab.value !== null ? `/content?status=${tab.value}` : "/content"
            }
            className={`whitespace-nowrap rounded-full px-5 py-2 text-sm font-medium transition ${
              statusFilter === tab.value
                ? "bg-white text-[#ff2442] shadow-sm font-semibold"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
        <div className="divide-y divide-slate-50">
          {loading ? (
            <div className="p-16 text-center text-sm text-slate-400">
              正在加载作品...
            </div>
          ) : filteredContents.length === 0 ? (
            <div className="p-16 text-center text-sm text-slate-400">
              暂无内容，去新建第一篇作品吧。
            </div>
          ) : (
            filteredContents.map((content) => {
              const isRejected = content.status === ContentStatus.Rejected;
              const isPending = content.status === ContentStatus.PendingReview;
              const isDraft = content.status === ContentStatus.Draft;
              const isPublished = content.status === ContentStatus.Published;
              const isReadyToPublish =
                content.status === ContentStatus.Approved ||
                content.status === ContentStatus.Updated;
              const metrics = [
                ["阅读", content.viewCount],
                ["点赞", content.likeCount],
                ["收藏", content.collectCount ?? 0]
              ] as const;

              return (
                <article
                  key={content.id}
                  className={`grid gap-4 p-4 transition lg:grid-cols-[112px_minmax(0,1fr)_auto_auto] lg:items-center ${
                    isRejected
                      ? "bg-[#fff3f5]/50 hover:bg-[#fff3f5]"
                      : "bg-white hover:bg-slate-50/80"
                  }`}
                >
                  <Link href={`/content/${content.id}`} className="block h-28 overflow-hidden rounded-2xl bg-slate-100 lg:h-24">
                    {content.coverUrl ? (
                      <img src={content.coverUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-rose-50 to-orange-50 text-rose-400">
                        <Icons.Image className="h-7 w-7" />
                      </div>
                    )}
                  </Link>

                  <div className="min-w-0">
                    <h3 className="m-0 truncate text-base font-bold text-slate-900">
                      {content.title || "未命名"}
                    </h3>
                    <p className="m-0 mt-1 line-clamp-1 text-sm text-slate-500">
                      {content.excerpt || "暂无摘要"}
                    </p>
                    <p className="m-0 mt-2 text-xs font-medium text-slate-400">
                      发布时间：{formatPublishedAt(content.publishedAt)}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-3">
                      {metrics.map(([label, value]) => (
                        <span key={label} className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                          {label} <strong className="text-slate-900">{value.toLocaleString()}</strong>
                        </span>
                      ))}
                    </div>

                    {isRejected && (
                      <div className="mt-4 flex items-start gap-3 rounded-xl border border-rose-100 bg-white p-3.5 shadow-sm">
                        <Icons.AlertTriangle className="mt-0.5 h-4 w-4 text-rose-500" />
                        <div>
                          <span className="mb-0.5 block text-xs font-bold text-rose-700">
                            需要调整后重新提交
                          </span>
                          <span className="text-xs text-rose-600/80">
                            可以先完成合规改写，再进入审核流程。
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 justify-start self-start">
                    <Link
                      href={`/content/${content.id}`}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Icons.Book className="h-4 w-4" />
                      查看详情
                    </Link>
                    <Link
                      href={`/editor?contentId=${content.id}`}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Icons.PenTool className="h-4 w-4" />
                      {isPublished ? "编辑作品" : "编辑作品"}
                    </Link>
                    <Link
                      href={`/editor?contentId=${content.id}`}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Icons.Settings className="h-4 w-4" />
                      设置权限
                    </Link>
                    <button
                      className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        isRejected
                          ? "bg-[#ff2442] text-white hover:bg-[#e91635] shadow-sm"
                        : isPending
                            ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : isDraft
                              ? "border border-slate-200 bg-white text-slate-700 hover:border-[#ff2442]/30 hover:text-[#ff2442]"
                              : isReadyToPublish
                                ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                                : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                      disabled={busyId === content.id}
                      onClick={() => handleLifecycleAction(content)}
                      type="button"
                    >
                      {isRejected && busyId !== content.id && (
                        <Icons.Sparkles className="h-4 w-4" />
                      )}
                      {isDraft && busyId !== content.id && (
                        <Icons.Refresh className="h-4 w-4" />
                      )}
                      {isPending && busyId !== content.id && (
                        <Icons.Shield className="h-4 w-4" />
                      )}
                      {isReadyToPublish && busyId !== content.id && (
                        <Icons.Rocket className="h-4 w-4" />
                      )}
                      {isPublished && busyId !== content.id && (
                        <Icons.Trash className="h-4 w-4" />
                      )}
                      {actionLabel(content, busyId)}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
