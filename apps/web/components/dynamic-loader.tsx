"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "./skeleton";

export const DynamicEditor = dynamic(
  () => import("../app/editor/rich-text-editor").then(mod => mod.RichTextEditor as any),
  {
    ssr: false,
    loading: () => (
      <div className="p-6 space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    ),
  }
);

export const DynamicMarkdownViewer = dynamic(
  () => import("react-markdown").then(mod => mod.default),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-40 w-full" />
      </div>
    ),
  }
);

export const DynamicGfm = dynamic(
  () => import("remark-gfm").then(mod => mod.default),
  { ssr: false }
);
