"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import type { ContentSummary, UserPublicProfileResponse } from "@aicp/shared";
import { useAuth } from "../../../components/auth-provider";
import { getUserContents, getUserPublicProfile, toggleUserFollow } from "../../../lib/api";

function formatDate(value?: string) {
  if (!value) return "暂未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂未发布";
  return date.toLocaleDateString("zh-CN");
}

export default function UserProfilePage({ params }: { params: { id: string } }) {
  const { refreshSession, status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [profileResponse, setProfileResponse] = useState<UserPublicProfileResponse | null>(null);
  const [contents, setContents] = useState<ContentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [profile, contentResponse] = await Promise.all([getUserPublicProfile(params.id), getUserContents(params.id)]);
        if (!cancelled) {
          setProfileResponse(profile);
          setContents(contentResponse.items);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "作者主页加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function handleFollow() {
    if (!profileResponse || profileResponse.viewerState.isSelf || followBusy) return;
    if (status !== "authenticated") {
      router.push(loginHref(pathname));
      return;
    }
    setFollowBusy(true);
    try {
      const result = await toggleUserFollow(profileResponse.profile.id);
      void refreshSession();
      setProfileResponse((current) =>
        current
          ? {
              profile: {
                ...current.profile,
                followerCount: result.followerCount,
              },
              viewerState: {
                ...current.viewerState,
                following: result.following,
              },
            }
          : current
      );
    } finally {
      setFollowBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-350 px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm font-semibold text-slate-500">正在加载作者主页...</div>
      </div>
    );
  }

  if (error || !profileResponse) {
    return (
      <div className="mx-auto max-w-350 px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl bg-rose-50 p-5 text-sm font-semibold text-rose-600">{error || "作者不存在"}</div>
      </div>
    );
  }

  const { profile, viewerState } = profileResponse;

  return (
    <div className="mx-auto w-full max-w-350 px-4 py-5 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-center gap-4">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className="grid h-20 w-20 place-items-center rounded-full bg-rose-600 text-2xl font-black text-white">
                {profile.nickname.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="m-0 truncate text-2xl font-black text-slate-950">{profile.nickname}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-400">
                {profile.accountNo ? `账号ID：${profile.accountNo}` : `加入时间：${formatDate(profile.createdAt)}`}
              </p>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{profile.bio || "这个作者还没有填写简介。"}</p>
            </div>
          </div>
          {viewerState.isSelf ? (
            <Link
              href="/studio/dashboard"
              className="inline-flex h-10 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-bold text-white transition hover:bg-slate-800"
            >
              进入首页
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void handleFollow()}
              disabled={followBusy}
              className={`inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                viewerState.following ? "border border-rose-200 bg-rose-50 text-rose-600" : "bg-rose-600 text-white hover:bg-rose-700"
              }`}
            >
              {followBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {viewerState.following ? "已关注" : "关注作者"}
            </button>
          )}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <ProfileMetric label="粉丝" value={profile.followerCount} />
          <ProfileMetric label="关注" value={profile.followingCount} />
          <ProfileMetric label="已发布作品" value={profile.contentCount} />
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="m-0 text-xl font-black text-slate-950">发布作品</h2>
          <span className="text-sm font-semibold text-slate-400">{contents.length} 篇</span>
        </div>
        {contents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-400">
            暂无已发布作品
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {contents.map((item) => (
              <Link
                key={item.id}
                href={`/content/${item.id}`}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="aspect-[4/3] bg-slate-100">
                  {item.coverUrl ? <img src={item.coverUrl} alt="" className="h-full w-full object-cover" /> : null}
                </div>
                <div className="p-4">
                  <h3 className="line-clamp-2 text-base font-black leading-6 text-slate-950">{item.title}</h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{item.excerpt}</p>
                  <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold text-slate-400">
                    <span>阅读 {item.viewCount}</span>
                    <span>点赞 {item.likeCount}</span>
                    <span>评论 {item.commentCount ?? 0}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function loginHref(pathname: string) {
  return `/login?returnTo=${encodeURIComponent(pathname)}`;
}

function ProfileMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs font-bold text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-950">{value.toLocaleString()}</p>
    </div>
  );
}
