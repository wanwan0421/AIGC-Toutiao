"use client";

import { useCallback, useRef, useState } from "react";
import type { AiJobEvent, AiJobSnapshot } from "@aicp/shared";
import { getAiJob, streamAiJobEvents } from "./api";

type AiJobRunHandlers = {
  onEvent?: (event: AiJobEvent) => void;
  onSnapshot?: (job: AiJobSnapshot) => void;
  onProgress?: (data: Record<string, unknown>) => void;
  onPartial?: (data: Record<string, unknown>) => void;
  onWarning?: (message: string, data: Record<string, unknown>) => void;
  onDone?: (job: AiJobSnapshot, result: unknown) => void;
  onError?: (message: string, job?: AiJobSnapshot) => void;
};

export function useAiJob() {
  const [job, setJob] = useState<AiJobSnapshot | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const runJob = useCallback(
    async (start: () => Promise<AiJobSnapshot>, handlers: AiJobRunHandlers = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const started = await start();
      let latest = started;
      setJob(started);
      setIsRunning(true);

      try {
        await streamAiJobEvents(
          started.id,
          {
            onEvent: handlers.onEvent,
            onSnapshot: (nextJob) => {
              latest = nextJob;
              setJob(nextJob);
              handlers.onSnapshot?.(nextJob);
            },
            onProgress: handlers.onProgress,
            onPartial: handlers.onPartial,
            onWarning: handlers.onWarning,
            onDone: (doneJob, result) => {
              latest = doneJob;
              setJob(doneJob);
              handlers.onDone?.(doneJob, result);
            },
            onError: (message, errorJob) => {
              if (errorJob) {
                latest = errorJob;
                setJob(errorJob);
              }
              handlers.onError?.(message, errorJob);
            },
          },
          controller.signal
        );
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          throw error;
        }
      } finally {
        // SSE 断线只停止前端订阅，不会取消后端任务；用快照恢复最终状态。
        const restored = await getAiJob(started.id).catch(() => latest);
        setJob(restored);
        setIsRunning(false);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }

      return latest;
    },
    []
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }, []);

  return {
    job,
    isRunning,
    runJob,
    stopStreaming,
  };
}
