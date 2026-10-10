import type { ReactNode } from "react";
import type { ApiError, ApiErrorKind } from "@/lib/api";
import { formatDuration, formatTimestamp } from "@/lib/format";
import { SEVERITY_META, severityText } from "@/lib/severity";
import type { TriageResponse } from "@/lib/types";
import { SeverityBadge } from "./SeverityBadge";

export type ResultState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: ApiError }
  | { kind: "success"; result: TriageResponse };

interface ResultPanelProps {
  state: ResultState;
  onRetry: () => void;
  canRetry: boolean;
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
  unknown: "Unexpected error",
};

export function MockLabel() {
  return (
    <span className="mock-stripes inline-flex items-center rounded border-2 border-amber-500 bg-amber-100 px-2 py-0.5 font-mono text-xs font-bold tracking-widest text-amber-950">
      MOCK RESULT
    </span>
  );
}

function Detail({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="w-32 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`min-w-0 break-words text-sm text-slate-900 ${mono ? "font-mono text-xs leading-5" : ""}`}>
        {children}
      </dd>
    </div>
  );
}

function Success({ result }: { result: TriageResponse }) {
  const meta = SEVERITY_META[result.severity];
  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-4 ${meta.surface}`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide opacity-80">Predicted severity</span>
          {result.is_mock && <MockLabel />}
        </div>
        <SeverityBadge severity={result.severity} size="lg" />
        <p className="sr-only">Predicted severity: {severityText(result.severity)}</p>
        <p className="mt-3 text-sm font-semibold text-slate-900">{result.incident_title}</p>
      </div>

      {result.is_mock && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Synthetic result from the <strong>mock</strong> provider (fixed rule for integration testing). It was not
          produced by Gemma or any model.
        </p>
      )}

      {result.human_review_required && (
        <div role="note" className="flex gap-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2.5">
          <span aria-hidden="true" className="mt-0.5 text-slate-700">
            ⚑
          </span>
          <div className="text-xs text-slate-700">
            <p className="font-semibold text-slate-900">Human review required</p>
            <p>This severity is an AI suggestion. An authorised engineer must confirm it before acting.</p>
          </div>
        </div>
      )}

      <dl className="divide-y divide-slate-100">
        <Detail label="Provider">
          {result.provider}
          {result.is_mock ? " (synthetic)" : ""}
        </Detail>
        <Detail label="Model" mono>
          {result.model_id}
        </Detail>
        <Detail label="Inference time">{formatDuration(result.inference_ms)}</Detail>
        <Detail label="Timestamp">
          <time dateTime={result.created_at}>{formatTimestamp(result.created_at)}</time>
        </Detail>
        <Detail label="Request ID" mono>
          {result.request_id}
        </Detail>
      </dl>
    </div>
  );
}

function ErrorView({ error, onRetry, canRetry }: { error: ApiError; onRetry: () => void; canRetry: boolean }) {
  const hint =
    error.kind === "validation"
      ? "Correct the highlighted fields and submit again."
      : error.kind === "invalid_output" || error.kind === "inference"
        ? "No severity was predicted for this incident."
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
      {error.retryable && canRetry && (
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

export function ResultPanel({ state, onRetry, canRetry }: ResultPanelProps) {
  return (
    <section aria-labelledby="result-heading" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 id="result-heading" className="text-base font-semibold text-slate-900">
          Triage result
        </h2>
        <p className="text-xs text-slate-500">Exactly what the API returned — severity only.</p>
      </div>
      <div className="px-5 py-5" aria-live="polite" aria-busy={state.kind === "loading"}>
        {state.kind === "idle" && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-xl text-slate-400">
              ◎
            </div>
            <p className="text-sm font-medium text-slate-700">No analysis yet</p>
            <p className="max-w-xs text-xs text-slate-500">
              Submit an incident to get a suggested severity from the configured inference provider.
            </p>
          </div>
        )}
        {state.kind === "loading" && (
          <div className="space-y-3" role="status">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-700" />
              Running severity inference…
            </div>
            <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
          </div>
        )}
        {state.kind === "error" && <ErrorView error={state.error} onRetry={onRetry} canRetry={canRetry} />}
        {state.kind === "success" && <Success result={state.result} />}
      </div>
    </section>
  );
}
