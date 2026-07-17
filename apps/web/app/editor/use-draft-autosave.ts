"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { autosaveDraft } from "../../lib/api";
import type { GeneratedImageCandidate } from "@aicp/shared";

export type EditorDraftCache = {
  savedAt: string;
  contentId: string | null;
  title: string;
  // Plain text is the semantic source for AI, review, scoring, search, and counters.
  body: string;
  // HTML is a readonly rendering cache for preview/detail fallback.
  html: string;
  // JSON is the editable Tiptap document shape used to restore rich text structure.
  json: Record<string, unknown> | null;
  briefTheme: string;
  audience: string;
  style: string;
  viewpoint: string;
  selectedTopics: string[];
  coverPreview: string;
  coverAssetId?: string | null;
  coverMode: "single" | "none";
  assetIds: string[];
  publishTimeMode: "now" | "scheduled";
  scheduledAt: string;
  selectedLocation: string;
  visibility: "public" | "followers" | "private";
  originalStatement: boolean;
  contentStatement: string;
  generatedImageCandidates?: GeneratedImageCandidate[];
};

type UseDraftAutosaveOptions = {
  editorReadyRef: MutableRefObject<boolean>;
  snapshotRef: MutableRefObject<() => EditorDraftCache>;
  draftStorageKey: (contentId: string | null) => string;
  ensureContentForDraft: (data: EditorDraftCache) => Promise<string>;
  isMeaningful: (data: EditorDraftCache) => boolean;
  onStatus: (message: string) => void;
  onCloudSaved?: () => void | Promise<void>;
};

function formatTime(value?: string) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function isQuotaExceededError(error: unknown) {
  return error instanceof DOMException && (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22 ||
    error.code === 1014
  );
}

// 草稿自动保存Hook抽离
export function useDraftAutosave(options: UseDraftAutosaveOptions) {
  const optionsRef = useRef(options);
  const saveLockRef = useRef(false);
  const localTimerRef = useRef<number | null>(null);
  const cloudTimerRef = useRef<number | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [localSaveError, setLocalSaveError] = useState("");

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // 读取本地草稿，返回 null 表示没有本地草稿或解析失败
  const readLocalDraft = useCallback((scopeId: string | null) => {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(optionsRef.current.draftStorageKey(scopeId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as EditorDraftCache;
    } catch {
      return null;
    }
  }, []);

  const removeLocalDraft = useCallback((scopeId: string | null) => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(optionsRef.current.draftStorageKey(scopeId));
  }, []);

  // 将当前编辑内容保存到本地草稿。这里继续使用 localStorage，但捕获空间不足，避免页面崩溃。
  const saveLocalDraftNow = useCallback((data?: EditorDraftCache) => {
    const current = optionsRef.current;
    if (typeof window === "undefined") return false;
    if (!current.editorReadyRef.current) return false;

    const nextData = data ?? current.snapshotRef.current();
    try {
      window.localStorage.setItem(current.draftStorageKey(nextData.contentId), JSON.stringify(nextData));
      setLocalSaveError("");
      return true;
    } catch (error) {
      const message = isQuotaExceededError(error)
        ? "本地空间不足，已优先尝试云端保存"
        : "本地保存失败，已优先尝试云端保存";
      setLocalSaveError(message);
      current.onStatus(message);
      return false;
    }
  }, []);

  // 判断本地草稿是否比云端更新。返回 true 表示本地有更新，false 表示本地没有更新或无法判断。
  const hasLocalChangesAfter = useCallback((savedAt: string, savedContentId: string) => {
    const savedTime = new Date(savedAt).getTime();
    if (Number.isNaN(savedTime)) return false;

    return [null, savedContentId].some((scopeId) => {
      const local = readLocalDraft(scopeId);
      if (!local) return false;
      const localTime = new Date(local.savedAt).getTime();
      return !Number.isNaN(localTime) && localTime > savedTime;
    });
  }, [readLocalDraft]);

  // 将当前编辑内容保存到云端草稿。这里会先保存到本地，再尝试保存到云端，避免网络不稳定导致数据丢失。
  const autoSaveDraft = useCallback(async (force = false) => {
    const current = optionsRef.current;
    if (!current.editorReadyRef.current) return;

    const data = current.snapshotRef.current();
    if (!current.isMeaningful(data) && !force) return;

    // 不论有无网络都先保存到本地；localStorage 失败时也继续尝试云端。
    saveLocalDraftNow(data);
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (saveLockRef.current) return;

    saveLockRef.current = true;
    try {
      const savedContentId = await current.ensureContentForDraft(data);
      await autosaveDraft(savedContentId, {
        title: data.title,
        body: data.body,
        payload: {
          html: data.html,
          json: data.json,
          tags: data.selectedTopics,
          coverPreview: data.coverPreview,
          coverAssetId: data.coverAssetId,
          coverMode: data.coverMode,
          assetIds: data.assetIds,
          briefTheme: data.briefTheme,
          audience: data.audience,
          style: data.style,
          viewpoint: data.viewpoint,
          publishTimeMode: data.publishTimeMode,
          scheduledAt: data.scheduledAt,
          selectedLocation: data.selectedLocation,
          visibility: data.visibility,
          originalStatement: data.originalStatement,
          contentStatement: data.contentStatement,
          generatedImageCandidates: data.generatedImageCandidates ?? [],
        },
        clientHash: String(Date.now()),
      });

      if (hasLocalChangesAfter(data.savedAt, savedContentId)) {
        current.onStatus("云端已保存，另有本地修改等待下次同步");
      } else {
        removeLocalDraft(null);
        removeLocalDraft(savedContentId);
        current.onStatus(`已自动保存到云端 · ${formatTime(new Date().toISOString())}`);
      }
      await current.onCloudSaved?.();
    } catch (error) {
      current.onStatus(error instanceof Error ? `云端保存失败：${error.message}` : "云端保存失败，已保留本地草稿");
    } finally {
      saveLockRef.current = false;
    }
  }, [hasLocalChangesAfter, removeLocalDraft, saveLocalDraftNow]);

  // 在用户输入时，防抖保存本地草稿，避免频繁写入 localStorage。
  const scheduleLocalDraftSave = useCallback(() => {
    if (typeof window === "undefined") return;
    if (localTimerRef.current) window.clearTimeout(localTimerRef.current);

    // 800ms 防抖写本地草稿，避免频繁写入 localStorage。
    localTimerRef.current = window.setTimeout(() => {
      saveLocalDraftNow();
      localTimerRef.current = null;
    }, 800);
  }, [saveLocalDraftNow]);

  // 在用户输入时，防抖保存云端草稿，避免频繁调用云端接口。
  const scheduleCloudAutosave = useCallback(() => {
    if (typeof window === "undefined") return;
    if (cloudTimerRef.current) window.clearTimeout(cloudTimerRef.current);

    // 3s 防抖写云端草稿，避免频繁调用云端接口。
    cloudTimerRef.current = window.setTimeout(() => {
      void autoSaveDraft();
      cloudTimerRef.current = null;
    }, 3000);
  }, [autoSaveDraft]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 固定轮询是防抖保存的兜底，避免用户持续编辑导致云端长期不同步。
    const interval = window.setInterval(() => {
      void autoSaveDraft();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [autoSaveDraft]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 监听网络状态变化，恢复网络时尝试同步本地草稿到云端。
    const onOnline = () => {
      setIsOnline(true);
      optionsRef.current.onStatus("网络已恢复，正在同步本地草稿...");
      void autoSaveDraft(true);
    };
    const onOffline = () => {
      setIsOnline(false);
      optionsRef.current.onStatus("当前处于离线状态，内容会先保存到本地");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [autoSaveDraft]);

  useEffect(() => {
    return () => {
      if (localTimerRef.current) window.clearTimeout(localTimerRef.current);
      if (cloudTimerRef.current) window.clearTimeout(cloudTimerRef.current);
    };
  }, []);

  return {
    isOnline,
    localSaveError,
    saveLocalDraftNow,
    scheduleLocalDraftSave,
    scheduleCloudAutosave,
    readLocalDraft,
    removeLocalDraft,
    autoSaveDraft,
  };
}
