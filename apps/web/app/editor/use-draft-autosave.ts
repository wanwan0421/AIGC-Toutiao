"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { autosaveDraft } from "../../lib/api";

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
  coverMode: "single" | "triple" | "none";
  assetIds: string[];
  publishTimeMode: "now" | "scheduled";
  scheduledAt: string;
  visibility: "public" | "followers" | "private";
  allowCopy: boolean;
  originalStatement: boolean;
  contentStatement: string;
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
          coverMode: data.coverMode,
          assetIds: data.assetIds,
          briefTheme: data.briefTheme,
          audience: data.audience,
          style: data.style,
          viewpoint: data.viewpoint,
          publishTimeMode: data.publishTimeMode,
          scheduledAt: data.scheduledAt,
          visibility: data.visibility,
          allowCopy: data.allowCopy,
          originalStatement: data.originalStatement,
          contentStatement: data.contentStatement,
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

  const scheduleLocalDraftSave = useCallback(() => {
    if (typeof window === "undefined") return;
    if (localTimerRef.current) window.clearTimeout(localTimerRef.current);

    // 防抖写本地：用户连续输入时只在停顿后写一次 localStorage，降低主线程和容量压力。
    localTimerRef.current = window.setTimeout(() => {
      saveLocalDraftNow();
      localTimerRef.current = null;
    }, 800);
  }, [saveLocalDraftNow]);

  const scheduleCloudAutosave = useCallback(() => {
    if (typeof window === "undefined") return;
    if (cloudTimerRef.current) window.clearTimeout(cloudTimerRef.current);

    // 防抖写云端：固定轮询仍保留，这里负责用户停顿后的快速同步。
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
