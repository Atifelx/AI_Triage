"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { AnalysisMode } from "./ResultPanel";
import type { InferenceHealth } from "@/lib/types";

interface ModeValue {
  /** Effective mode: full when the triage adapter is loaded, unless the user picked otherwise. */
  mode: AnalysisMode;
  fullAvailable: boolean;
  setMode: (mode: AnalysisMode) => void;
}

const ModeContext = createContext<ModeValue | null>(null);

export function AnalysisModeProvider({ inference, children }: { inference: InferenceHealth | null; children: ReactNode }) {
  const [choice, setChoice] = useState<AnalysisMode | null>(null);
  const fullAvailable = Boolean(inference?.triage?.available);
  const mode: AnalysisMode = choice === "full" && !fullAvailable ? "severity" : choice ?? (fullAvailable ? "full" : "severity");
  return <ModeContext.Provider value={{ mode, fullAvailable, setMode: setChoice }}>{children}</ModeContext.Provider>;
}

export function useAnalysisMode(): ModeValue {
  const value = useContext(ModeContext);
  if (!value) throw new Error("useAnalysisMode must be used inside <AnalysisModeProvider>");
  return value;
}

/** Segmented control for Full triage / Severity only. */
export function ModeSwitch({
  inference,
  disabled = false,
  align = "end",
}: {
  inference: InferenceHealth | null;
  disabled?: boolean;
  align?: "start" | "end";
}) {
  const { mode, setMode, fullAvailable } = useAnalysisMode();
  const triage = inference?.triage ?? null;
  const option = (value: AnalysisMode, label: string, enabled: boolean) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === value}
      disabled={!enabled || disabled}
      onClick={() => setMode(value)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        mode === value ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className={`flex flex-col gap-1 ${align === "end" ? "items-start sm:items-end" : "items-stretch"}`}>
      <div role="radiogroup" aria-label="Analysis mode" className="flex gap-1 rounded-lg bg-slate-200/60 p-1 [&>button]:flex-1">
        {option("full", "Full triage", fullAvailable)}
        {option("severity", "Severity only", true)}
      </div>
      {!fullAvailable && (
        <p className={`max-w-xs text-xs text-muted ${align === "end" ? "sm:text-right" : ""}`}>Full triage unavailable{triage?.detail ? `: ${triage.detail}` : "."}</p>
      )}
    </div>
  );
}

/** Right-rail card: the mode switch plus which adapter answers what. */
export function ModeCard({ inference, disabled = false }: { inference: InferenceHealth | null; disabled?: boolean }) {
  const { mode } = useAnalysisMode();
  const short = (id: string | null | undefined) => id?.split("LoRA:")[1] ?? id ?? "—";
  return (
    <section aria-labelledby="mode-card" className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <h2 id="mode-card" className="text-sm font-semibold text-ink">
        Mode
      </h2>
      <ModeSwitch inference={inference} disabled={disabled} align="start" />
      {mode === "full" ? (
        <dl className="space-y-2 text-xs">
          <div>
            <dt className="text-muted">Category, root cause, proof, actions</dt>
            <dd className="font-mono text-[11px] text-slate-700">{short(inference?.triage?.model_id)}</dd>
          </div>
          <div>
            <dt className="text-muted">Severity</dt>
            <dd className="font-mono text-[11px] text-slate-700">{short(inference?.model_id)}</dd>
          </div>
          <p className="text-muted">Both adapters share one base model; each ticket runs both.</p>
        </dl>
      ) : (
        <p className="text-xs text-muted">Severity only, from {short(inference?.model_id)}.</p>
      )}
    </section>
  );
}
