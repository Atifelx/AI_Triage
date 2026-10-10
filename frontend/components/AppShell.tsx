"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useHealth, type BackendStatus } from "@/hooks/useHealth";
import { API_BASE_URL } from "@/lib/api";
import type { InferenceHealth } from "@/lib/types";
import { AppHeader } from "./AppHeader";
import { SystemBanner } from "./SystemBanner";

export interface HealthContextValue {
  backend: BackendStatus;
  inference: InferenceHealth | null;
  refresh: () => void;
}

const HealthContext = createContext<HealthContextValue | null>(null);

export function useHealthContext(): HealthContextValue {
  const value = useContext(HealthContext);
  if (!value) throw new Error("useHealthContext must be used inside <AppShell>");
  return value;
}

/** Why inference is currently blocked, or null when the provider can serve requests. */
export function blockedReason(backend: BackendStatus, inference: InferenceHealth | null): string | null {
  if (backend === "checking") return "Connecting to the backend…";
  if (backend === "offline" || !inference) return "Backend unavailable — analysis is disabled.";
  if (inference.ready) return null;
  if (inference.state === "unavailable") return "Model unavailable — analysis is disabled.";
  return "Model is loading — analysis will be enabled when it is ready.";
}

/** Header, navigation and system banners shared by every view; polls /health once. */
export function AppShell({ children }: { children: ReactNode }) {
  const { backend, health, error, refresh } = useHealth();
  const inference = health?.inference ?? null;

  return (
    <HealthContext.Provider value={{ backend, inference, refresh }}>
      <div className="min-h-screen bg-slate-100">
        <AppHeader backend={backend} inference={inference} />
        <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
          <SystemBanner backend={backend} inference={inference} error={error} onRetry={refresh} />
          {children}
          <footer className="flex flex-col gap-1 border-t border-slate-200 pt-4 text-xs text-slate-500 sm:flex-row sm:justify-between">
            <span>Prototype · severity classification only · results kept in memory, not persisted</span>
            <span className="font-mono">API: {API_BASE_URL}</span>
          </footer>
        </main>
      </div>
    </HealthContext.Provider>
  );
}
