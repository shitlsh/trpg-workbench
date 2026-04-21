import { useEffect, useState, useRef } from "react";
import { apiFetch } from "../lib/api";
import type { IngestTask } from "@trpg-workbench/shared-schema";

const POLL_INTERVAL_MS = 2000;

export function useTaskProgress(taskId: string | null) {
  const [task, setTask] = useState<IngestTask | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!taskId) return;

    const poll = async () => {
      try {
        const t = await apiFetch<IngestTask>(`/tasks/${taskId}/status`);
        setTask(t);
        if (t.status === "completed" || t.status === "failed") {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch {
        // ignore transient errors
      }
    };

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [taskId]);

  return task;
}
