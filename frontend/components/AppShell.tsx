"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useHealth, type BackendStatus } from "@/hooks/useHealth";
import { API_BASE_URL } from "@/lib/api";
import type { InferenceHealth } from "@/lib/types";
import { AppHeader } from "./AppHeader";
import { AnalysisModeProvider } from "./AnalysisMode";
import { ReviewStoreProvider } from "./ReviewStore";
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
      <AnalysisModeProvider inference={inference}>
      <ReviewStoreProvider>
      <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <AppHeader backend={backend} inference={inference} />
        <div className="min-w-0 overflow-x-clip">
          <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            <SystemBanner backend={backend} inference={inference} error={error} onRetry={refresh} />
            {children}
          </main>
          <footer className="mx-auto flex max-w-[1440px] flex-col gap-1 px-4 pb-6 text-[11px] text-muted sm:flex-row sm:justify-between sm:px-6 lg:px-10">
            <span>AI suggestions require human review. Session data is kept in memory and is not persisted.</span>
            <span className="font-mono">API {API_BASE_URL}</span>
          </footer>
        </div>
      </div>
      </ReviewStoreProvider>
      </AnalysisModeProvider>
    </HealthContext.Provider>
  );
}
