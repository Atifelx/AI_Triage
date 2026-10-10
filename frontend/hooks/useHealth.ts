"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, getHealth } from "@/lib/api";
import type { HealthResponse } from "@/lib/types";

export type BackendStatus = "checking" | "online" | "offline";

export interface HealthState {
  backend: BackendStatus;
  /** Null whenever the backend is not confirmed online — never show stale readiness. */
  health: HealthResponse | null;
  error: string | null;
  lastChecked: Date | null;
}

const POLL_READY_MS = 15_000;
const POLL_NOT_READY_MS = 3_000; // model loading: refresh quickly
const POLL_OFFLINE_MS = 5_000;

export function useHealth(): HealthState & { refresh: () => void } {
  const [state, setState] = useState<HealthState>({
    backend: "checking",
    health: null,
    error: null,
    lastChecked: null,
  });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    getHealth(controller.signal)
      .then((health) => {
        if (controller.signal.aborted) return;
        setState({ backend: "online", health, error: null, lastChecked: new Date() });
        timer = setTimeout(refresh, health.inference.ready ? POLL_READY_MS : POLL_NOT_READY_MS);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          backend: "offline",
          health: null,
          error: err instanceof ApiError ? err.message : "The backend is unreachable.",
          lastChecked: new Date(),
        });
        timer = setTimeout(refresh, POLL_OFFLINE_MS);
      });

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [tick, refresh]);

  return { ...state, refresh };
}
