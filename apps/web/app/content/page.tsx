"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ContentStatus,
  type AiJobSnapshot,
  type ContentSummary,
  type ContentVisibility,
} from "@aicp/shared";
import { Icons } from "../../components/icons";
import {
  deleteContent,
  getContents,
  updateContentVisibility,
} from "../../lib/api";
import { useAiJob } from "../../lib/use-ai-job";

const statusLabels: Record<ContentStatus, string> = {
  [ContentStatus.Draft]: "草稿",
  [ContentStatus.PendingReview]: "安全审核通过",
  [ContentStatus.Approved]: "审核通过",
  [ContentStatus.Rejected]: "审核驳回",
  [ContentStatus.Scheduled]: "定时发布",
  [ContentStatus.Published]: "已发布",
  [ContentStatus.Updated]: "已更新",
  [ContentStatus.Offline]: "已下线",
};

const statusClasses: Record<ContentStatus, string> = {
  [ContentStatus.Draft]: "bg-slate-100 text-slate-600",
  [ContentStatus.PendingReview]: "bg-amber-50 text-amber-700",
  [ContentStatus.Approved]: "bg-emerald-50 text-emerald-700",
  [ContentStatus.Rejected]: "bg-rose-50 text-rose-700",
  [ContentStatus.Scheduled]: "bg-blue-50 text-blue-700",
  [ContentStatus.Published]: "bg-emerald-50 text-emerald-700",
  [ContentStatus.Updated]: "bg-blue-50 text-blue-700",
  [ContentStatus.Offline]: "bg-slate-100 text-slate-500",
};

const draftWorkbenchStatuses = new Set<ContentStatus>([
  ContentStatus.Draft,
  ContentStatus.PendingReview,
  ContentStatus.Approved,
  ContentStatus.Scheduled,
  ContentStatus.Updated,
  ContentStatus.Rejected,
]);

const visibilityLabels: Record<ContentVisibility, string> = {
  public: "公开",
  followers: "仅粉丝可见",
  private: "仅自己可见",
};

function isContentStatus(value: string | null): value is ContentStatus {
  return Object.values(ContentStatus).includes(value as ContentStatus);
}

function formatTime(value?: string) {
  if (!value) return "暂未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function StatusPill({ status }: { status: ContentStatus }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusClasses[status]}`}>
      {statusLabels[status]}
    </span>
  );
}

/**
 * 💡 抽取出的单行作品组件
 * 让每一行都拥有独立的下拉框状态和点击检测 Ref
 */
function ContentRow({
  content,
  busyId,
  handleVisibilityChange,
  handleDeleteContent,
}: {
  content: ContentSummary;
  busyId: string | null;
  handleVisibilityChange: (content: ContentSummary, visibility: ContentVisibility) => Promise<void>;
  handleDeleteContent: (content: ContentSummary) => Promise<void>;
}) {
  const [isVisibilityOpen, setIsVisibilityOpen] = useState(false);
  const visibilityRef = useRef<HTMLDivElement>(null);

  // 每一行独立监听自己的点击外部事件
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (visibilityRef.current && !visibilityRef.current.contains(event.target as Node)) {
        setIsVisibilityOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const metrics = [
    ["阅读", content.viewCount],
    ["点赞", content.likeCount],
    ["收藏", content.collectCount ?? 0],
  ] as const;

  return (
    <article className="grid gap-4 p-4 transition hover:bg-slate-50/80 lg:grid-cols-[112px_minmax(0,1fr)_auto] lg:items-center">
      {/* 封面图 */}
      <Link
        href={`/content/${content.id}`}
        className="block h-28 overflow-hidden rounded-2xl bg-slate-100 lg:h-24"
      >
        {content.coverUrl ? (
          <img src={content.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-rose-50 to-orange-50 text-rose-400">
            <Icons.Image className="h-7 w-7" />
          </div>
        )}
      </Link>

      {/* 核心信息 */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 truncate text-base font-bold text-slate-900">
            {content.title || "未命名作品"}
          </h3>
          <StatusPill status={content.status} />
        </div>
        <p className="m-0 mt-1 line-clamp-1 text-sm text-slate-500">
          {content.excerpt || "暂无摘要"}
        </p>
        <p className="m-0 mt-2 text-xs font-medium text-slate-400">
          发布时间：{formatTime(content.publishedAt)}
        </p>
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

      {/* 右侧操作按钮区域 */}
      <div className="flex flex-wrap h-full items-start justify-start gap-2 lg:justify-end">
        {/* 权限设置 Popover Container */}
        <div className="relative" ref={visibilityRef}>
          <button
            type="button"
            disabled={busyId === content.id}
            onClick={() => setIsVisibilityOpen(!isVisibilityOpen)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
              isVisibilityOpen
                ? "bg-slate-900 text-white shadow-md"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icons.Book className="h-4 w-4" />
            <span>设置权限</span>
            <svg
              className={`h-3.5 w-3.5 opacity-60 transition-transform duration-200 ${isVisibilityOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {/* 展开的浮动精美选项面板 */}
          {isVisibilityOpen && (
            <div className="absolute left-0 mt-2 w-44 origin-top-left rounded-2xl border border-slate-100 bg-white p-1.5 shadow-xl ring-1 ring-black/5 z-30 animate-in fade-in slide-in-from-top-1 duration-150 lg:left-auto lg:right-0 lg:origin-top-right">
              {(Object.keys(visibilityLabels) as ContentVisibility[]).map((visibility) => {
                const isActive = content.visibility === visibility;
                return (
                  <button
                    key={visibility}
                    type="button"
                    onClick={() => {
                      void handleVisibilityChange(content, visibility);
                      setIsVisibilityOpen(false); // 选择后自动关闭当前行的下拉框
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-rose-50 text-rose-600 font-semibold"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <span>{visibilityLabels[visibility]}</span>
                    {isActive && <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Link
          href={`/editor?contentId=${content.id}`}
          className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <Icons.PenTool className="h-4 w-4" /> 编辑作品
        </Link>
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
}

/**
 * 🏠 主页面组件
 */
export default function ContentPage() {
  const searchParams = useSearchParams();
  const statusFilterValue = searchParams.get("status");
  const statusFilter = isContentStatus(statusFilterValue) ? statusFilterValue : null;
  const isDraftWorkbenchFilter = statusFilterValue === "drafts" || statusFilter === ContentStatus.Draft;

  const [contents, setContents] = useState<ContentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("正在加载作品...");
  const [loadError, setLoadError] = useState("");

  const filteredContents = useMemo(() => {
    if (isDraftWorkbenchFilter) {
      return contents.filter((item) => draftWorkbenchStatuses.has(item.status));
    }
    return statusFilter ? contents.filter((item) => item.status === statusFilter) : contents;
  }, [contents, isDraftWorkbenchFilter, statusFilter]);

  const loadContents = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setLoadError("");
    try {
      const response = await getContents();
      setContents(response);
      setMessage(`已加载 ${response.length} 篇作品`);
    } catch (error) {
      const nextMessage = error instanceof Error ? `加载失败：${error.message}` : "加载失败";
      setLoadError(nextMessage);
      setMessage(nextMessage);
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContents();
  }, [loadContents]);

  useEffect(() => {
    function refreshOnReturn() {
      if (document.visibilityState === "visible") {
        void loadContents({ silent: true });
      }
    }
    window.addEventListener("focus", refreshOnReturn);
    window.addEventListener("pageshow", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      window.removeEventListener("pageshow", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [loadContents]);

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

  async function handleVisibilityChange(content: ContentSummary, visibility: ContentVisibility) {
    if (content.visibility === visibility) return;
    setBusyId(content.id);
    try {
      const updated = await updateContentVisibility(content.id, visibility);
      setContents((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setMessage(`「${content.title || "未命名作品"}」权限已设为${visibilityLabels[visibility]}`);
      await loadContents({ silent: true });
    } catch (error) {
      setMessage(error instanceof Error ? `权限设置失败：${error.message}` : "权限设置失败");
    } finally {
      setBusyId(null);
    }
  }

  const tabs = [
    { label: "全部作品", href: "/content", active: !statusFilterValue },
    { label: "已发布", href: `/content?status=${ContentStatus.Published}`, active: statusFilter === ContentStatus.Published },
    { label: "草稿箱", href: "/content?status=drafts", active: isDraftWorkbenchFilter },
    { label: "未通过", href: `/content?status=${ContentStatus.Rejected}`, active: statusFilter === ContentStatus.Rejected },
  ];

  return (
    <section className="mx-auto min-h-full max-w-350 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950">作品管理</h1>
        <Link
          href="/editor"
          className="flex items-center gap-2 rounded-full bg-[#ff2442] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e91635]"
        >
          <Icons.Plus className="h-4 w-4" /> 发布新作品
        </Link>
      </header>

      {/* 标签页 */}
      <div className="mb-6 flex w-max max-w-full overflow-x-auto rounded-full bg-slate-100 p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={tab.href}
            className={`whitespace-nowrap rounded-full px-5 py-2 text-sm font-medium transition ${
              tab.active
                ? "bg-white font-semibold text-[#ff2442] shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* 列表面板 */}
      <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
        {loading ? (
          <div className="p-16 text-center text-sm text-slate-400">正在加载作品...</div>
        ) : loadError ? (
          <div className="grid gap-3 p-16 text-center text-sm text-rose-500">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() => void loadContents()}
              className="mx-auto rounded-full bg-rose-600 px-5 py-2 text-sm font-bold text-white"
            >
              重新加载
            </button>
          </div>
        ) : filteredContents.length === 0 ? (
          <div className="grid gap-3 p-16 text-center text-sm text-slate-400">
            <span>{contents.length ? "当前筛选下暂无作品" : "暂无内容，去新建第一篇作品吧。"}</span>
            {contents.length && statusFilterValue ? (
              <Link href="/content" className="mx-auto rounded-full bg-slate-900 px-5 py-2 text-sm font-bold text-white">
                查看全部作品
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {filteredContents.map((content) => (
              <ContentRow
                key={content.id}
                content={content}
                busyId={busyId}
                handleVisibilityChange={handleVisibilityChange}
                handleDeleteContent={handleDeleteContent}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
