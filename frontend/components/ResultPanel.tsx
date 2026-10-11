import type { ReactNode } from "react";
import type { ApiError, ApiErrorKind } from "@/lib/api";
import { formatDuration, formatTimestamp } from "@/lib/format";
import { severityText } from "@/lib/severity";
import type { FullTriageResponse, TriageResponse } from "@/lib/types";
import { FullTriageResult, InfoLayer, type Reference } from "./FullTriageResult";
import { SeverityLadder } from "./SeverityLadder";

export type AnalysisMode = "full" | "severity";

export type ResultState =
  | { kind: "idle" }
  | { kind: "loading"; mode?: AnalysisMode }
  | { kind: "error"; error: ApiError }
  | { kind: "success"; result: TriageResponse }
  | { kind: "full"; result: FullTriageResponse };

interface ResultPanelProps {
  state: ResultState;
  onRetry: () => void;
  canRetry: boolean;
  /** Shown for full results; opens the review-routing modal. */
  onSendForReview?: () => void;
  /** Dataset label for a loaded held-out example (shown after inference). */
  reference?: Reference | null;
}

const ERROR_TITLES: Record<ApiErrorKind, string> = {
  network: "Backend unavailable",
  validation: "Input rejected by the API",
  not_ready: "Model not ready",
  unavailable: "Model unavailable",
  inference: "Inference failed",
  invalid_output: "Model returned invalid output",
  not_found: "Result not found",
  conflict: "Request conflicts with the queue state",
  queue_unavailable: "Ticket queue unavailable",
  triage_unavailable: "Full triage adapter unavailable",
  timeout: "Inference timed out",
  unknown: "Unexpected error",
};

export function MockLabel() {
  return (
    <span className="mock-stripes inline-flex items-center rounded border-2 border-amber-500 bg-amber-100 px-2 py-0.5 font-mono text-xs font-bold tracking-widest text-amber-950">
      MOCK RESULT
    </span>
  );
}

function Success({ result }: { result: TriageResponse }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-3">
          {result.is_mock && <MockLabel />}
          <h3 className="text-lg font-semibold leading-snug text-ink">{result.incident_title}</h3>
          <p className="sr-only">Predicted severity: {severityText(result.severity)}</p>
          {result.is_mock && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              Synthetic result from the <strong>mock</strong> provider (fixed rule for integration testing). It was not
              produced by Gemma or any model.
            </p>
          )}
          {result.human_review_required && (
            <div role="note" className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-xs text-slate-700">
              <p className="font-semibold text-ink">Human review required</p>
              <p>This severity is an AI suggestion. An authorised engineer must confirm it before acting.</p>
            </div>
          )}
        </div>
        <SeverityLadder predicted={result.severity} />
      </div>
      <InfoLayer
        items={[
          ["Model", <span key="m">{result.model_id}</span>],
          ["Provider", `${result.provider}${result.is_mock ? " (synthetic)" : ""}`],
          ["Inference", formatDuration(result.inference_ms)],
          ["Time", <time key="t" dateTime={result.created_at}>{formatTimestamp(result.created_at)}</time>],
          ["Request", result.request_id],
        ]}
      />
    </div>
  );
}

function ErrorView({ error, onRetry, canRetry }: { error: ApiError; onRetry: () => void; canRetry: boolean }) {
  const hint =
    error.kind === "validation"
      ? "Correct the highlighted fields and submit again."
      : error.kind === "invalid_output" || error.kind === "inference" || error.kind === "timeout"
        ? "No severity was predicted for this incident."
        : error.kind === "triage_unavailable"
          ? "Switch to Severity only, or configure TRIAGE_ADAPTER_PATH and restart the backend."
          : null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-semibold text-red-900">{ERROR_TITLES[error.kind]}</p>
      <p className="mt-1 text-sm text-red-800">{error.message}</p>
      {hint && <p className="mt-1 text-xs text-red-800">{hint}</p>}
      {(error.code || error.requestId) && (
        <p className="mt-2 font-mono text-[11px] text-red-700">
          {error.code && <>code: {error.code}</>}
          {error.code && error.requestId && " · "}
          {error.requestId && <>request: {error.requestId}</>}
        </p>
      )}
      {error.kind === "invalid_output" && (
        <p className="mt-1 text-xs text-red-800">
          Decoding is deterministic, so retrying the same input returns the same output.
        </p>
      )}
      {error.rawOutput != null && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-red-900">Raw model output (development)</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 font-mono text-[11px] text-slate-800">
            {error.rawOutput}
          </pre>
        </details>
      )}
      {error.retryable && canRetry && error.kind !== "triage_unavailable" && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function ResultPanel({ state, onRetry, canRetry, onSendForReview, reference }: ResultPanelProps) {
  const full = state.kind === "full" || (state.kind === "loading" && state.mode === "full");
  return (
    <section aria-labelledby="result-heading" className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="border-b border-line px-6 py-4">
        <h2 id="result-heading" className="text-base font-semibold text-ink">
          Triage result
        </h2>
        <p className="text-xs text-muted">
          {full
            ? "Exactly what the API returned — full five-field analysis."
            : "Exactly what the API returned — severity only."}
        </p>
      </div>
      <div className="px-6 py-5" aria-live="polite" aria-busy={state.kind === "loading"}>
        {state.kind === "idle" && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-xl text-slate-400">
              ◎
            </div>
            <p className="text-sm font-medium text-slate-700">No analysis yet</p>
            <p className="max-w-xs text-xs text-muted">
              Submit an incident to get a suggested severity from the configured inference provider.
            </p>
          </div>
        )}
        {state.kind === "loading" && (
          <div className="space-y-3" role="status">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-700" />
              {full ? "Analyzing incident (full triage)…" : "Running severity inference…"}
            </div>
            <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
          </div>
        )}
        {state.kind === "error" && <ErrorView error={state.error} onRetry={onRetry} canRetry={canRetry} />}
        {state.kind === "success" && <Success result={state.result} />}
        {state.kind === "full" && (
          <FullTriageResult result={state.result} onSendForReview={onSendForReview} reference={reference} />
        )}
      </div>
    </section>
  );
}
