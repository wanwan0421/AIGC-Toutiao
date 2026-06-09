"use client";

import { useCallback, useRef, useState } from "react";
import { AiJobStatus, type AiJobEvent, type AiJobSnapshot } from "@aicp/shared";
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
      let terminalHandled = false;
      let streamAborted = false;
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
              terminalHandled = true;
              latest = doneJob;
              setJob(doneJob);
              handlers.onDone?.(doneJob, result);
            },
            onError: (message, errorJob) => {
              if (errorJob) {
                terminalHandled = isTerminalJob(errorJob);
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
        streamAborted = true;
      } finally {
        const restored = await getAiJob(started.id).catch(() => latest);
        latest = restored;
        setJob(restored);
        setIsRunning(false);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }

        if (!streamAborted && !terminalHandled) {
          if (restored.status === AiJobStatus.Succeeded) {
            terminalHandled = true;
            handlers.onDone?.(restored, restored.result);
          } else if (restored.status === AiJobStatus.Failed || restored.status === AiJobStatus.Cancelled) {
            terminalHandled = true;
            handlers.onError?.(restored.errorMessage ?? terminalErrorMessage(restored), restored);
          }
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

function isTerminalJob(job: AiJobSnapshot) {
  return job.status === AiJobStatus.Succeeded || job.status === AiJobStatus.Failed || job.status === AiJobStatus.Cancelled;
}

function terminalErrorMessage(job: AiJobSnapshot) {
  return job.status === AiJobStatus.Cancelled ? "AI 任务已取消" : "AI 任务失败";
}
