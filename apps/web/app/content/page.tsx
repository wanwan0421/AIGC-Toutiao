"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ContentStatus, type AiJobSnapshot, type AuditResult, type ComplianceRewriteResult, type ContentApprovalResult, type ContentSummary } from "@aicp/shared";
import { Icons } from "../../components/icons";
import {
  deleteContent,
  getContentDetail,
  getContents,
  offlineContent,
  publishContent,
  startApproveContentJob,
  startComplianceRewriteJob,
  startSubmitReviewJob,
  updateContent,
} from "../../lib/api";
import { useAiJob } from "../../lib/use-ai-job";

const statusLabels: Record<ContentStatus, string> = {
  [ContentStatus.Draft]: "草稿",
  [ContentStatus.PendingReview]: "待审核",
  [ContentStatus.Approved]: "审核通过",
  [ContentStatus.Rejected]: "审核驳回",
  [ContentStatus.Published]: "已发布",
  [ContentStatus.Updated]: "已更新",
  [ContentStatus.Offline]: "已下线",
};

const statusClasses: Record<ContentStatus, string> = {
  [ContentStatus.Draft]: "bg-slate-100 text-slate-600",
  [ContentStatus.PendingReview]: "bg-amber-50 text-amber-700",
  [ContentStatus.Approved]: "bg-emerald-50 text-emerald-700",
  [ContentStatus.Rejected]: "bg-rose-50 text-rose-700",
  [ContentStatus.Published]: "bg-emerald-50 text-emerald-700",
  [ContentStatus.Updated]: "bg-blue-50 text-blue-700",
  [ContentStatus.Offline]: "bg-slate-100 text-slate-500",
};

function formatTime(value?: string) {
  if (!value) return "暂未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", { hour12: false });
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

function StatusPill({ status }: { status: ContentStatus }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusClasses[status]}`}>
      {statusLabels[status]}
    </span>
  );
}

export default function ContentPage() {
  const searchParams = useSearchParams();
  const { runJob } = useAiJob();
  const statusFilterValue = searchParams.get("status");
  const statusFilter = Object.values(ContentStatus).includes(statusFilterValue as ContentStatus)
    ? (statusFilterValue as ContentStatus)
    : null;

  const [contents, setContents] = useState<ContentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("正在加载作品...");

  const filteredContents = useMemo(
    () => (statusFilter ? contents.filter((item) => item.status === statusFilter) : contents),
    [contents, statusFilter]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadContents() {
      try {
        const response = await getContents();
        if (!cancelled) {
          setContents(response);
          setMessage(`已加载 ${response.length} 篇作品`);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? `加载失败：${error.message}` : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadContents();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshContents() {
    setContents(await getContents());
  }

  async function runContentJob<T>(
    start: () => Promise<AiJobSnapshot>,
    fallbackError: string
  ) {
    const job = await runJob(start, {
      onProgress: (data) => {
        if (typeof data.message === "string") setMessage(data.message);
      },
      onWarning: (warning) => setMessage(warning),
      onError: (errorMessage) => setMessage(`${fallbackError}：${errorMessage}`),
    });
    if (job.status !== "succeeded" || !job.result) {
      throw new Error(job.errorMessage ?? fallbackError);
    }
    return job.result as T;
  }

  async function handleLifecycleAction(content: ContentSummary) {
    setBusyId(content.id);

    try {
      if (content.status === ContentStatus.Rejected) {
        const detail = await getContentDetail(content.id);
        const rewritten = await runContentJob<ComplianceRewriteResult>(
          () =>
            startComplianceRewriteJob({
              title: detail.title,
              body: detail.body,
              reasons: ["降低夸张表达", "补充事实描述", "增强合规性"],
            }),
          "合规改写失败"
        );

        await updateContent(content.id, {
          title: rewritten.title,
          body: rewritten.body,
          tags: detail.tags,
        });
        setMessage(`已完成「${detail.title}」的合规改写`);
      } else if (content.status === ContentStatus.Draft) {
        const response = await runContentJob<{
          content: ContentSummary;
          audit: AuditResult;
          quality: null;
          rewrite: ComplianceRewriteResult | null;
        }>(() => startSubmitReviewJob(content.id), "提交审核失败");
        setMessage(
          response.audit.passed
            ? "草稿已提交审核，审核通过后将生成质量分"
            : `草稿审核未通过：${response.audit.reasons.join("；")}`
        );
      } else if (content.status === ContentStatus.PendingReview) {
        const approved = await runContentJob<ContentApprovalResult>(
          () => startApproveContentJob(content.id),
          "审核通过失败"
        );
        setMessage(`「${content.title}」已通过审核，质量分 ${approved.quality.total}`);
      } else if (content.status === ContentStatus.Approved || content.status === ContentStatus.Updated) {
        await publishContent(content.id);
        setMessage(`「${content.title}」已发布`);
      } else if (content.status === ContentStatus.Published) {
        await offlineContent(content.id);
        setMessage(`「${content.title}」已下线`);
      }

      await refreshContents();
    } catch (error) {
      setMessage(error instanceof Error ? `操作失败：${error.message}` : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteContent(content: ContentSummary) {
    const ok = window.confirm(`确定删除「${content.title || "未命名作品"}」吗？删除后不可恢复。`);
    if (!ok) return;
    setBusyId(content.id);
    try {
      await deleteContent(content.id);
      setContents((items) => items.filter((item) => item.id !== content.id));
      setMessage(`已删除「${content.title || "未命名作品"}」`);
    } catch (error) {
      setMessage(error instanceof Error ? `删除失败：${error.message}` : "删除失败");
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
    <section className="mx-auto min-h-full max-w-350 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">作品管理</h1>
          <p className="mt-2 text-sm text-slate-500">{message}</p>
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
            href={tab.value ? `/content?status=${tab.value}` : "/content"}
            className={`whitespace-nowrap rounded-full px-5 py-2 text-sm font-medium transition ${
              statusFilter === tab.value
                ? "bg-white font-semibold text-[#ff2442] shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
        {loading ? (
          <div className="p-16 text-center text-sm text-slate-400">正在加载作品...</div>
        ) : filteredContents.length === 0 ? (
          <div className="p-16 text-center text-sm text-slate-400">暂无内容，去新建第一篇作品吧。</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {filteredContents.map((content) => {
              const isReadyToPublish = content.status === ContentStatus.Approved || content.status === ContentStatus.Updated;
              const metrics = [
                ["阅读", content.viewCount],
                ["点赞", content.likeCount],
                ["收藏", content.collectCount ?? 0],
              ] as const;

              return (
                <article key={content.id} className="grid gap-4 p-4 transition hover:bg-slate-50/80 lg:grid-cols-[112px_minmax(0,1fr)_auto] lg:items-center">
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
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="m-0 truncate text-base font-bold text-slate-900">{content.title || "未命名作品"}</h3>
                      <StatusPill status={content.status} />
                    </div>
                    <p className="m-0 mt-1 line-clamp-1 text-sm text-slate-500">{content.excerpt || "暂无摘要"}</p>
                    <p className="m-0 mt-2 text-xs font-medium text-slate-400">发布时间：{formatTime(content.publishedAt)}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {metrics.map(([label, value]) => (
                        <span key={label} className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                          {label} <strong className="text-slate-900">{value.toLocaleString()}</strong>
                        </span>
                      ))}
                      <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                        质量分 <strong className="text-slate-900">{content.qualityScore}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
                    <Link href={`/content/${content.id}`} className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
                      <Icons.Book className="h-4 w-4" /> 查看详情
                    </Link>
                    <Link href={`/editor?contentId=${content.id}`} className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
                      <Icons.PenTool className="h-4 w-4" /> 编辑作品
                    </Link>
                    <button
                      type="button"
                      disabled={busyId === content.id}
                      onClick={() => void handleLifecycleAction(content)}
                      className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        content.status === ContentStatus.Rejected
                          ? "bg-[#ff2442] text-white hover:bg-[#e91635]"
                          : content.status === ContentStatus.PendingReview
                            ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : isReadyToPublish
                              ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                              : "border border-slate-200 bg-white text-slate-700 hover:border-[#ff2442]/30 hover:text-[#ff2442]"
                      }`}
                    >
                      {content.status === ContentStatus.Rejected ? <Icons.Sparkles className="h-4 w-4" /> : null}
                      {content.status === ContentStatus.Draft ? <Icons.Refresh className="h-4 w-4" /> : null}
                      {content.status === ContentStatus.PendingReview ? <Icons.Shield className="h-4 w-4" /> : null}
                      {isReadyToPublish ? <Icons.Rocket className="h-4 w-4" /> : null}
                      {content.status === ContentStatus.Published ? <Icons.Trash className="h-4 w-4" /> : null}
                      {actionLabel(content, busyId)}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === content.id}
                      onClick={() => void handleDeleteContent(content)}
                      className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Icons.Trash className="h-4 w-4" /> 删除
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
