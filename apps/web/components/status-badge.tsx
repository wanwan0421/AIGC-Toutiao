import { ContentStatus } from "@aicp/shared";

const labelMap: Record<ContentStatus, string> = {
  [ContentStatus.Draft]: "草稿",
  [ContentStatus.PendingReview]: "待审核",
  [ContentStatus.Approved]: "审核通过",
  [ContentStatus.Rejected]: "审核驳回",
  [ContentStatus.Published]: "已发布",
  [ContentStatus.Updated]: "已更新",
  [ContentStatus.Offline]: "已下线"
};

const classMap: Record<ContentStatus, string> = {
  [ContentStatus.Draft]: "bg-slate-100 text-slate-600",
  [ContentStatus.PendingReview]: "bg-amber-50 text-amber-700",
  [ContentStatus.Approved]: "bg-emerald-50 text-emerald-700",
  [ContentStatus.Rejected]: "bg-rose-50 text-rose-700",
  [ContentStatus.Published]: "bg-emerald-50 text-emerald-700",
  [ContentStatus.Updated]: "bg-blue-50 text-blue-700",
  [ContentStatus.Offline]: "bg-slate-100 text-slate-500"
};

export function StatusBadge({ status }: { status: ContentStatus }) {
  return (
    <span className={`inline-flex min-h-6 w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-black ${classMap[status]}`}>
      {labelMap[status]}
    </span>
  );
}
