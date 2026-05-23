"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ContentStatus, type ContentSummary } from "@aicp/shared";
import { Icons } from "../../components/icons";
import {
  approveContent,
  getContentDetail,
  getContents,
  offlineContent,
  publishContent,
  rewriteText,
  submitReview,
  updateContent
} from "../../lib/api";
import { StatusBadge } from "../../components/status-badge";

function formatUpdatedAt(value: string) {
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) {
    return "更新时间未知";
  }

  return updatedAt.toLocaleString("zh-CN", { hour12: false });
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
  const [message, setMessage] = useState("后端内容列表正在加载...");

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
          setMessage(`已从后端加载 ${response.length} 条作品`);
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
          reasons: ["降低夸张表达", "补充事实描述", "增强合规性"]
        });

        await updateContent(content.id, {
          title: rewritten.title,
          body: rewritten.body,
          tags: detail.tags
        });

        setMessage(`已完成 ${detail.title} 的合规改写`);
      } else if (content.status === ContentStatus.Draft) {
        const response = await submitReview(content.id);
        setMessage(response.audit.passed ? `草稿已提交审核，质量分 ${response.quality.total}` : `草稿审核未通过，质量分 ${response.quality.total}`);
      } else if (content.status === ContentStatus.PendingReview) {
        await approveContent(content.id);
        setMessage(`${content.title} 已通过审核`);
      } else if (content.status === ContentStatus.Approved || content.status === ContentStatus.Updated) {
        await publishContent(content.id);
        setMessage(`${content.title} 已发布`);
      } else if (content.status === ContentStatus.Published) {
        await offlineContent(content.id);
        setMessage(`${content.title} 已下线`);
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
    <div className="p-6 md:p-10 max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-slate-900 m-0">作品管理</h1>
          <p className="text-sm text-slate-500 mt-1">管理、分析并优化您的内容资产</p>
          <p className="mt-2 text-xs font-medium text-slate-400">{message}</p>
        </div>
        <Link href="/editor" className="bg-[#0E121B] text-white hover:bg-slate-800 px-4 py-2.5 rounded-lg font-semibold text-sm transition flex items-center gap-2 shadow-sm">
          <Icons.Plus className="w-4 h-4" /> 新建作品
        </Link>
      </div>

      <div className="flex bg-slate-100/80 p-1 rounded-xl w-max mb-6 overflow-x-auto max-w-full">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={tab.value !== null ? `/content?status=${tab.value}` : `/content`}
            className={`px-5 py-2 text-sm font-semibold rounded-lg transition whitespace-nowrap ${statusFilter === tab.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="divide-y divide-slate-100">
          {loading ? (
            <div className="p-16 text-center text-slate-400 text-sm">正在从后端加载作品...</div>
          ) : filteredContents.length === 0 ? (
            <div className="p-16 text-center text-slate-400 text-sm">暂无内容，去新建第一篇爆款吧！</div>
          ) : (
            filteredContents.map((content) => {
              const isRejected = content.status === ContentStatus.Rejected;
              const isPending = content.status === ContentStatus.PendingReview;
              const isDraft = content.status === ContentStatus.Draft;
              const isPublished = content.status === ContentStatus.Published;
              const isReadyToPublish = content.status === ContentStatus.Approved || content.status === ContentStatus.Updated;

              return (
                <div key={content.id} className={`p-6 transition flex flex-col sm:flex-row gap-5 items-start sm:items-center ${isRejected ? "bg-rose-50/20 hover:bg-rose-50/40" : "hover:bg-slate-50/50"}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                       <StatusBadge status={content.status} />
                       <span className="text-xs font-medium text-slate-400">最后更新: {formatUpdatedAt(content.updatedAt)}</span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 m-0 mb-1.5 truncate">{content.title || "未命名"}</h3>
                    <p className="text-sm text-slate-500 m-0 line-clamp-1">{content.excerpt || "暂无摘要"}</p>

                    {isRejected && (
                      <div className="mt-4 p-3.5 bg-white border border-rose-100 rounded-xl flex items-start gap-3 shadow-sm">
                        <Icons.AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5" />
                        <div>
                          <span className="text-xs font-bold text-rose-700 block mb-0.5">AI 诊断拦截</span>
                          <span className="text-xs text-rose-600/80">点击改写会调用后端合规改写接口，再写回数据库。</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="w-24 shrink-0 text-right max-sm:hidden">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">热度引擎</div>
                    <span className="text-sm font-black text-slate-700">{content.heatScore || 0}</span>
                  </div>

                  <div className="shrink-0 flex items-center gap-2 flex-wrap">
                    <Link href={`/content/${content.id}`} className="p-2.5 text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded-lg transition" title="查看详情">
                      <Icons.Book className="w-4 h-4" />
                    </Link>
                    <Link href="/editor" className="p-2.5 text-slate-400 hover:text-slate-800 bg-slate-50 hover:bg-slate-200 rounded-lg transition" title="编辑">
                      <Icons.PenTool className="w-4 h-4" />
                    </Link>
                    <button
                      className={`px-4 py-2 rounded-lg text-sm font-bold transition flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60 ${isRejected ? "bg-rose-100 hover:bg-rose-200 text-rose-700" : isPending ? "bg-blue-100 hover:bg-blue-200 text-blue-700" : isDraft ? "bg-slate-100 hover:bg-slate-200 text-slate-700" : isReadyToPublish ? "bg-emerald-100 hover:bg-emerald-200 text-emerald-700" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}
                      disabled={busyId === content.id}
                      onClick={() => handleLifecycleAction(content)}
                      type="button"
                    >
                      {busyId === content.id ? "处理中..." : isRejected ? <><Icons.Sparkles className="w-4 h-4" /> 一键合规改写</> : isDraft ? <><Icons.Refresh className="w-4 h-4" /> 提交审核</> : isPending ? <><Icons.Shield className="w-4 h-4" /> 通过审核</> : isReadyToPublish ? <><Icons.Rocket className="w-4 h-4" /> 发布</> : isPublished ? <><Icons.Trash className="w-4 h-4" /> 下线</> : "执行操作"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
