"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, MessageCircle, Send } from "lucide-react";
import type { ContentCommentSummary, ContentDetail, ContentReactionToggleResult } from "@aicp/shared";
import { RichTextRenderer } from "../../editor/rich-text-editor";
import { ContentDetailActions } from "../../../components/content-detail-actions";
import { StatusBadge } from "../../../components/status-badge";
import { useAuth } from "../../../components/auth-provider";
import { OptimizedImage } from "../../../components/optimized-image";
import { createContentComment, getContentComments, getContentDetail, toggleUserFollow } from "../../../lib/api";

function formatDate(value?: string) {
  if (!value) return "暂未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂未发布";
  return date.toLocaleString("zh-CN", { hour12: false });
}

export default function ContentDetailPage({ params }: { params: { id: string } }) {
  const { refreshSession } = useAuth();
  const [detail, setDetail] = useState<ContentDetail | null>(null);
  const [comments, setComments] = useState<ContentCommentSummary[]>([]);
  const [commentCursor, setCommentCursor] = useState<string | undefined>();
  const [commentInput, setCommentInput] = useState("");
  const [commentMessage, setCommentMessage] = useState("");
  const [commentsDone, setCommentsDone] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [followBusy, setFollowBusy] = useState(false);
  const commentSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      setCommentMessage("");
      try {
        const nextDetail = await getContentDetail(params.id);
        if (!cancelled) setDetail(nextDetail);

        try {
          const commentResponse = await getContentComments(params.id, { limit: 10 });
          if (cancelled) return;
          setComments(commentResponse.items);
          setCommentCursor(commentResponse.nextCursor);
          setCommentsDone(!commentResponse.nextCursor);
        } catch (commentError) {
          if (cancelled) return;
          setComments([]);
          setCommentCursor(undefined);
          setCommentsDone(true);
          setCommentMessage(commentError instanceof Error ? `评论暂时不可用：${commentError.message}` : "评论暂时不可用");
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "内容加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function loadMoreComments() {
    if (commentsLoading || commentsDone) return;
    setCommentsLoading(true);
    try {
      const response = await getContentComments(params.id, { limit: 10, cursor: commentCursor });
      setComments((items) => mergeComments(items, response.items));
      setCommentCursor(response.nextCursor);
      setCommentsDone(!response.nextCursor);
    } catch (loadError) {
      setCommentMessage(loadError instanceof Error ? loadError.message : "评论加载失败");
    } finally {
      setCommentsLoading(false);
    }
  }

  useEffect(() => {
    const target = commentSentinelRef.current;
    if (!target || commentsDone) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMoreComments();
      },
      { rootMargin: "180px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentCursor, commentsDone, commentsLoading]);

  function handleMetricsChange(metrics: { viewCount: number; likeCount: number; collectCount: number; heatScore: number }) {
    setDetail((current) => (current ? { ...current, ...metrics } : current));
  }

  function handleReactionChange(result: ContentReactionToggleResult) {
    setDetail((current) =>
      current
        ? {
            ...current,
            likeCount: result.likeCount,
            collectCount: result.collectCount,
            heatScore: result.heatScore,
            viewerState: {
              liked: result.type === "like" ? result.active : Boolean(current.viewerState?.liked),
              collected: result.type === "collect" ? result.active : Boolean(current.viewerState?.collected),
              followingAuthor: Boolean(current.viewerState?.followingAuthor),
              isAuthor: Boolean(current.viewerState?.isAuthor),
            },
          }
        : current
    );
  }

  async function handleFollowAuthor() {
    if (!detail || followBusy || detail.viewerState?.isAuthor) return;
    setFollowBusy(true);
    try {
      const result = await toggleUserFollow(detail.author.id);
      void refreshSession();
      setDetail((current) =>
        current
          ? {
              ...current,
              viewerState: {
                liked: Boolean(current.viewerState?.liked),
                collected: Boolean(current.viewerState?.collected),
                followingAuthor: result.following,
                isAuthor: Boolean(current.viewerState?.isAuthor),
              },
            }
          : current
      );
    } finally {
      setFollowBusy(false);
    }
  }

  async function submitComment() {
    const body = commentInput.trim();
    if (!body || commentSubmitting) return;
    setCommentSubmitting(true);
    setCommentMessage("");
    try {
      const created = await createContentComment(params.id, { body });
      setComments((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      setCommentInput("");
      setDetail((current) =>
        current ? { ...current, heatScore: current.heatScore + 1, commentCount: (current.commentCount ?? 0) + 1 } : current
      );
      setCommentMessage("评论已发布");
    } catch (submitError) {
      setCommentMessage(submitError instanceof Error ? submitError.message : "评论发布失败");
    } finally {
      setCommentSubmitting(false);
    }
  }

  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm font-semibold text-slate-500">正在加载内容...</div>;
  }

  if (error || !detail) {
    return <div className="rounded-2xl bg-rose-50 p-5 text-sm font-semibold text-rose-600">{error || "内容不存在"}</div>;
  }

  return (
    <article className="mx-auto max-w-350 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="grid grid-cols-[64px_minmax(0,1fr)_320px] items-start gap-5 max-lg:grid-cols-1">
        <div className="hidden lg:block" />
        <header className="mb-5 min-w-0">
          <h1 className="m-0 max-w-4xl text-3xl font-black leading-tight tracking-tight text-slate-950">{detail.title}</h1>
          <p className="mt-3 text-sm leading-7 text-slate-500">发布时间：{formatDate(detail.publishedAt)}</p>
        </header>
        <div className="hidden lg:block" />

        <aside className="sticky top-5 -ml-3 max-lg:static max-lg:mx-auto max-lg:ml-0">
          <ContentDetailActions
            contentId={params.id}
            title={detail.title}
            viewerState={detail.viewerState}
            metrics={{
              viewCount: detail.viewCount,
              likeCount: detail.likeCount,
              collectCount: detail.collectCount,
              heatScore: detail.heatScore,
            }}
            variant="rail"
            onMetricsChange={handleMetricsChange}
            onReactionChange={handleReactionChange}
          />
        </aside>

        <main className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="relative min-h-72 overflow-hidden bg-slate-100">
            {detail.coverUrl || detail.assets[0]?.url ? (
              <OptimizedImage src={detail.coverUrl ?? detail.assets[0]?.url} alt="" width={1200} height={400} priority={true} className="h-72 w-full" />
            ) : (
              <div className="h-72 bg-linear-to-br from-rose-50 via-orange-50 to-slate-100" />
            )}
          </div>
          <div className="min-w-0 overflow-x-auto p-7 text-base leading-9 text-slate-700 [&_table]:my-4 [&_table]:min-w-max [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left">
            {detail.bodyHtml || detail.bodyJson ? (
              <RichTextRenderer
                content={{
                  html: detail.bodyHtml,
                  json: detail.bodyJson,
                  text: detail.body,
                }}
              />
            ) : (
              detail.body.split("\n\n").map((paragraph) => (
                <p className="m-0 mb-5 last:mb-0" key={paragraph}>
                  {paragraph}
                </p>
              ))
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              {detail.tags.map((tag) => (
                <span className="inline-flex min-h-6 items-center rounded-full bg-slate-100 px-3 py-0.5 text-xs font-black text-slate-600" key={tag}>
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          <section className="border-t border-slate-100 p-7">
            <div className="mb-4 flex items-center gap-2">
              <MessageCircle className="text-rose-600" size={20} />
              <h2 className="m-0 text-lg font-black text-slate-950">评论互动</h2>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <textarea
                value={commentInput}
                onChange={(event) => setCommentInput(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="写下你的看法，和作者继续讨论..."
                className="w-full resize-none bg-transparent p-2 text-sm leading-6 outline-none placeholder:text-slate-400"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-slate-400">{commentInput.trim().length}/1000</span>
                <button
                  type="button"
                  onClick={() => void submitComment()}
                  disabled={!commentInput.trim() || commentSubmitting}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-rose-600 px-5 text-sm font-bold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {commentSubmitting ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                  发布评论
                </button>
              </div>
            </div>
            {commentMessage ? <p className="mt-3 text-sm font-semibold text-slate-500">{commentMessage}</p> : null}
            <div className="mt-5 grid gap-3">
              {comments.map((comment) => (
                <div key={comment.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <Link href={`/users/${comment.author.id}`} className="flex min-w-0 items-center gap-3">
                      {comment.author.avatarUrl ? (
                        <div className="h-9 w-9 overflow-hidden rounded-full"><OptimizedImage src={comment.author.avatarUrl} alt="" width={36} height={36} priority={false} /></div>
                      ) : (
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-rose-600 text-xs font-black text-white">
                          {comment.author.nickname.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <span className="truncate text-sm font-bold text-slate-900">{comment.author.nickname}</span>
                    </Link>
                    <span className="shrink-0 text-xs font-semibold text-slate-400">{formatDate(comment.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600">{comment.body}</p>
                </div>
              ))}
            </div>
            <div ref={commentSentinelRef} className="mt-5 grid min-h-10 place-items-center text-sm font-semibold text-slate-400">
              {commentsLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="animate-spin" size={16} />
                  正在加载更多评论
                </span>
              ) : commentsDone ? (
                comments.length ? "评论已全部加载" : "还没有评论，来写第一条吧"
              ) : (
                "继续向下滚动加载评论"
              )}
            </div>
          </section>
        </main>

        <aside className="sticky top-5 grid content-start gap-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 text-lg font-black text-slate-950">作者信息</h2>
            <Link href={`/users/${detail.author.id}`} className="mt-4 flex items-center gap-3 rounded-2xl p-2 transition hover:bg-slate-50">
              {detail.author.avatarUrl ? (
                <div className="h-12 w-12 overflow-hidden rounded-full"><OptimizedImage src={detail.author.avatarUrl} alt="" width={48} height={48} priority={false} /></div>
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded-full bg-rose-600 text-sm font-black text-white">
                  {detail.author.nickname.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">{detail.author.nickname}</p>
                <p className="text-xs text-slate-400">
                  {detail.author.accountNo ? `账号ID：${detail.author.accountNo}` : "查看作者个人中心"}
                </p>
              </div>
            </Link>
            {!detail.viewerState?.isAuthor ? (
              <button
                type="button"
                onClick={() => void handleFollowAuthor()}
                disabled={followBusy}
                className={`mt-4 h-10 w-full rounded-full text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  detail.viewerState?.followingAuthor
                    ? "border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                    : "bg-rose-600 text-white hover:bg-rose-700"
                }`}
              >
                {followBusy ? "处理中..." : detail.viewerState?.followingAuthor ? "已关注" : "关注作者"}
              </button>
            ) : (
              <Link
                href="/dashboard"
                className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-full bg-slate-950 text-sm font-bold text-white transition hover:bg-slate-800"
              >
                进入首页
              </Link>
            )}
          </section>
        </aside>
      </div>
    </article>
  );
}

function mergeComments(current: ContentCommentSummary[], incoming: ContentCommentSummary[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}
