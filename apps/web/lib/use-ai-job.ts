"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AiJobStatus, type AiJobEvent, type AiJobSnapshot } from "@aicp/shared";
import { ApiError, cancelAiJob, getAiJob, streamAiJobEvents } from "./api";
import {
  listStoredAiJobs,
  persistAiJobSession,
  removeStoredAiJob,
  updateStoredAiJobEventId,
} from "./ai-job-session";
import {
  isEventAfter,
  reconnectDelay,
  shouldResetReconnectForEvent,
  wasConnectionStable,
} from "./ai-job-reconnect";

export type AiJobRunHandlers = {
  onEvent?: (event: AiJobEvent) => void;
  onSnapshot?: (job: AiJobSnapshot) => void;
  onProgress?: (data: Record<string, unknown>) => void;
  onPartial?: (data: Record<string, unknown>) => void;
  onWarning?: (message: string, data: Record<string, unknown>) => void;
  onResultReady?: (job: AiJobSnapshot, result: unknown, event: AiJobEvent) => void | Promise<void>;
  onDone?: (job: AiJobSnapshot, result: unknown) => void | Promise<void>;
  onError?: (message: string, job?: AiJobSnapshot) => void;
};

export function useAiJob() {
  const [job, setJob] = useState<AiJobSnapshot | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const terminalHandledJobIdsRef = useRef(new Set<string>());

  useEffect(() => {
    mountedRef.current = true;
    const handleAuthCleared = () => {
      abortRef.current?.abort();
      abortRef.current = null;
      if (mountedRef.current) setIsRunning(false);
    };
    window.addEventListener("aicp:auth-cleared", handleAuthCleared);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("aicp:auth-cleared", handleAuthCleared);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // 处理 AI 任务事件流
  const consumeJob = useCallback(
    async (
      started: AiJobSnapshot,
      handlers: AiJobRunHandlers,
      controller: AbortController,
      initialLastEventId?: string
    ) => {
      let latest = started;
      let lastEventId = initialLastEventId;
      let reconnectAttempt = 0;

      const updateLatest = (nextJob: AiJobSnapshot) => {
        latest = nextJob;
        if (!isTerminalJob(nextJob)) persistAiJobSession(nextJob, lastEventId);
        if (mountedRef.current && abortRef.current === controller) setJob(nextJob);
      };

      const handleDone = async (doneJob: AiJobSnapshot, result: unknown) => {
        if (terminalHandledJobIdsRef.current.has(doneJob.id)) return;
        updateLatest(doneJob);
        await handlers.onDone?.(doneJob, result);
        terminalHandledJobIdsRef.current.add(doneJob.id);
        removeStoredAiJob(doneJob.id);
      };

      const handleError = (message: string, errorJob?: AiJobSnapshot) => {
        if (!errorJob || !isTerminalJob(errorJob)) {
          handlers.onError?.(message, errorJob);
          return;
        }
        if (terminalHandledJobIdsRef.current.has(errorJob.id)) return;
        updateLatest(errorJob);
        handlers.onError?.(message, errorJob);
        terminalHandledJobIdsRef.current.add(errorJob.id);
        removeStoredAiJob(errorJob.id);
      };

      const handleTerminalSnapshot = async (snapshot: AiJobSnapshot) => {
        if (snapshot.status === AiJobStatus.Succeeded) {
          await handleDone(snapshot, snapshot.result);
        } else if (snapshot.status === AiJobStatus.Failed || snapshot.status === AiJobStatus.Cancelled) {
          handleError(snapshot.errorMessage ?? terminalErrorMessage(snapshot), snapshot);
        }
      };

      // 循环处理 AI 任务事件流，直到任务完成或被中止
      while (!controller.signal.aborted) {
        const connectionStartedAt = Date.now();
        const connectionStartLastEventId = lastEventId;
        let processedNewPersistedEvent = false;
        let retryAfterMs: number | undefined;
        try {
          await streamAiJobEvents(
            started.id,
            {
              // 判断事件是否需要处理，如果事件没有 ID 或者事件 ID 大于上次处理的事件 ID，则需要处理
              shouldHandleEvent: (event) => !event.id || isEventAfter(event.id, lastEventId),
              onEvent: (event) => {
                const eventJob = event.data.job as AiJobSnapshot | undefined;
                if (eventJob?.id === started.id) updateLatest(eventJob);
                handlers.onEvent?.(event);
              },
              onEventProcessed: (event) => {
                if (!event.id) return;
                if (shouldResetReconnectForEvent(event, connectionStartLastEventId)) {
                  processedNewPersistedEvent = true;
                  reconnectAttempt = 0;
                }
                lastEventId = event.id;
                updateStoredAiJobEventId(started.id, event.id);
              },
              onSnapshot: (nextJob) => {
                updateLatest(nextJob);
                handlers.onSnapshot?.(nextJob);
              },
              onProgress: handlers.onProgress,
              onPartial: handlers.onPartial,
              onWarning: handlers.onWarning,
              onResultReady: handlers.onResultReady,
              onDone: handleDone,
              onError: handleError,
            },
            controller.signal,
            lastEventId
          );
        } catch (error) {
          if (isAbortError(error)) throw error;
          if (!isRetryableError(error)) {
            handlers.onError?.(error instanceof Error ? error.message : "AI 任务流连接失败", latest);
            if (error instanceof ApiError && error.status === 404) removeStoredAiJob(started.id);
            return latest;
          }
          if (error instanceof ApiError) retryAfterMs = error.retryAfterMs;
        }

        if (!processedNewPersistedEvent && wasConnectionStable(connectionStartedAt)) reconnectAttempt = 0;

        if (controller.signal.aborted) break;

        // 检查任务是否已经完成，如果完成则处理终止快照并退出循环
        let restored: AiJobSnapshot;
        try {
          restored = await getAiJob(started.id);
        } catch (error) {
          if (isAbortError(error)) throw error;
          if (!isRetryableError(error)) {
            handlers.onError?.(error instanceof Error ? error.message : "AI 任务状态查询失败", latest);
            if (error instanceof ApiError && error.status === 404) removeStoredAiJob(started.id);
            return latest;
          }
          restored = latest;
        }
        updateLatest(restored);
        if (isTerminalJob(restored)) {
          await handleTerminalSnapshot(restored);
          return latest;
        }

        // 如果任务未完成，则计算重连延迟并等待一段时间后继续处理事件流，指数退避
        const delayMs = reconnectDelay(reconnectAttempt, retryAfterMs);
        reconnectAttempt += 1;
        handlers.onWarning?.("AI 任务流连接已中断，正在自动重连", {
          reconnecting: true,
          attempt: reconnectAttempt,
          delayMs,
          jobId: started.id,
        });
        await abortableDelay(delayMs, controller.signal);
      }

      return latest;
    },
    []
  );

  const runJob = useCallback(
    async (start: () => Promise<AiJobSnapshot>, handlers: AiJobRunHandlers = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      let started: AiJobSnapshot;
      try {
        // 执行传入的启动函数，获取已启动的 AI 任务快照
        started = await start();
      } catch (error) {
        if (abortRef.current === controller) abortRef.current = null;
        throw error;
      }

      // 将已启动的 AI 任务快照持久化到本地存储中，以便在页面刷新或关闭后能够恢复任务状态
      persistAiJobSession(started);
      if (mountedRef.current && abortRef.current === controller) {
        setJob(started);
        setIsRunning(true);
      }

      try {
        return await consumeJob(started, handlers, controller);
      } catch (error) {
        if (!isAbortError(error)) throw error;
        return getAiJob(started.id).catch(() => started);
      } finally {
        if (mountedRef.current && abortRef.current === controller) setIsRunning(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [consumeJob]
  );

  // 恢复任务
  const resumeJob = useCallback(
    async (jobId: string, handlers: AiJobRunHandlers = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const stored = listStoredAiJobs().find((item) => item.jobId === jobId);

      let started: AiJobSnapshot;
      try {
        started = await getAiJob(jobId);
      } catch (error) {
        if (isMissingJobError(error)) removeStoredAiJob(jobId);
        if (abortRef.current === controller) abortRef.current = null;
        throw error;
      }

      persistAiJobSession(started, stored?.lastEventId);
      if (mountedRef.current && abortRef.current === controller) {
        setJob(started);
        setIsRunning(!isTerminalJob(started));
      }

      try {
        if (isTerminalJob(started)) {
          if (started.status === AiJobStatus.Succeeded) {
            await handlers.onDone?.(started, started.result);
          } else {
            handlers.onError?.(started.errorMessage ?? terminalErrorMessage(started), started);
          }
          terminalHandledJobIdsRef.current.add(started.id);
          removeStoredAiJob(started.id);
          return started;
        }
        return await consumeJob(started, handlers, controller, stored?.lastEventId);
      } catch (error) {
        if (!isAbortError(error)) throw error;
        return getAiJob(started.id).catch(() => started);
      } finally {
        if (mountedRef.current && abortRef.current === controller) setIsRunning(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [consumeJob]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (mountedRef.current) setIsRunning(false);
  }, []);

  const cancelJob = useCallback(async (jobId?: string) => {
    const targetId = jobId ?? job?.id;
    if (!targetId) return null;
    const cancelled = await cancelAiJob(targetId);
    abortRef.current?.abort();
    removeStoredAiJob(targetId);
    if (mountedRef.current) {
      setJob(cancelled);
      setIsRunning(false);
    }
    return cancelled;
  }, [job?.id]);

  return {
    job,
    isRunning,
    runJob,
    resumeJob,
    cancelJob,
    stopStreaming,
  };
}

// 检查任务是否已经完成
function isTerminalJob(job: AiJobSnapshot) {
  return job.status === AiJobStatus.Succeeded || job.status === AiJobStatus.Failed || job.status === AiJobStatus.Cancelled;
}

// 获取任务终止状态的错误消息
function terminalErrorMessage(job: AiJobSnapshot) {
  return job.status === AiJobStatus.Cancelled ? "AI 任务已取消" : "AI 任务失败";
}

// 创建可中止的延迟
function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isRetryableError(error: unknown) {
  if (error instanceof ApiError) return error.retryable;
  return error instanceof TypeError;
}

function isMissingJobError(error: unknown) {
  if (error instanceof ApiError) return error.status === 404;
  return error instanceof Error && /AI job not found|任务不存在/i.test(error.message);
}
