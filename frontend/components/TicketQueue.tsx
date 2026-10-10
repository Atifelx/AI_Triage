"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import {
  ApiError,
  analyzeTicket,
  getNextTicket,
  getTicketSession,
  resetTicketSession,
} from "@/lib/api";
import { formatDuration, formatTimestamp } from "@/lib/format";
import type { Severity, Ticket, TicketAnalysisResponse, TicketResult } from "@/lib/types";
import { blockedReason, useHealthContext } from "./AppShell";
import { MockLabel } from "./ResultPanel";
import { SeverityBadge } from "./SeverityBadge";

type QueueView =
  | { kind: "loading" }
  | { kind: "error"; error: ApiError }
  | { kind: "ticket"; ticket: Ticket }
  | { kind: "exhausted"; message: string };

interface AnalysisView {
  severity: Severity | null; // null => the model returned invalid output
  expected: Severity;
  correct: boolean | null;
  provider: string;
  modelId: string;
  isMock: boolean;
  inferenceMs: number | null;
  at: string;
  requestId: string;
}

type AnalysisState =
  | { kind: "none" }
  | { kind: "running" }
  | { kind: "done"; result: AnalysisView }
  | { kind: "error"; error: ApiError };

interface Counters {
  issued: number;
  total: number;
  analyzed: number;
}

const fromResponse = (r: TicketAnalysisResponse): AnalysisView => ({
  severity: r.severity,
  expected: r.expected_severity,
  correct: r.correct,
  provider: r.provider,
  modelId: r.model_id,
  isMock: r.is_mock,
  inferenceMs: r.inference_ms,
  at: r.created_at,
  requestId: r.request_id,
});

const fromResult = (r: TicketResult): AnalysisView => ({
  severity: r.predicted_severity,
  expected: r.expected_severity,
  correct: r.correct,
  provider: r.provider,
  modelId: r.model_id,
  isMock: r.is_mock,
  inferenceMs: r.inference_ms,
  at: r.analyzed_at,
  requestId: r.request_id,
});

const asApiError = (err: unknown) =>
  err instanceof ApiError ? err : new ApiError("unknown", "An unexpected error occurred.");

export function ProviderTag({ isMock, provider }: { isMock: boolean; provider: string }) {
  if (isMock) return <MockLabel />;
  return (
    <span className="inline-flex items-center rounded border border-indigo-300 bg-indigo-50 px-2 py-0.5 font-mono text-xs font-bold tracking-wide text-indigo-900">
      MODEL PREDICTION · {provider.toUpperCase()}
    </span>
  );
}

function Button({
  variant,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant: "primary" | "secondary" }) {
  const styles =
    variant === "primary"
      ? "bg-sky-700 text-white hover:bg-sky-800 disabled:bg-slate-400 focus-visible:outline-sky-700"
      : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400 focus-visible:outline-sky-600";
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold shadow-sm disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 ${styles} ${className}`}
      {...props}
    />
  );
}

function Spinner({ light = false }: { light?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-4 w-4 animate-spin rounded-full border-2 ${light ? "border-white/40 border-t-white" : "border-slate-300 border-t-sky-700"}`}
    />
  );
}

function ProgressCard({ counters }: { counters: Counters }) {
  const pct = counters.total ? Math.round((counters.issued / counters.total) * 100) : 0;
  return (
    <section aria-labelledby="progress-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="progress-heading" className="text-sm font-semibold text-slate-900">
        Session progress
      </h2>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label="Tickets issued"
        aria-valuemin={0}
        aria-valuemax={counters.total}
        aria-valuenow={counters.issued}
      >
        <div className="h-full rounded-full bg-sky-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Issued</dt>
          <dd className="font-semibold tabular-nums text-slate-900">
            {counters.issued} / {counters.total}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Analyzed</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{counters.analyzed}</dd>
        </div>
      </dl>
      <Link href="/evaluation" className="mt-3 inline-block text-xs font-semibold text-sky-700 hover:underline">
        Open evaluation →
      </Link>
    </section>
  );
}

function AnalysisCard({
  state,
  providerLabel,
  onRetry,
}: {
  state: AnalysisState;
  providerLabel: string;
  onRetry: () => void;
}) {
  return (
    <section aria-labelledby="analysis-heading" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 id="analysis-heading" className="text-base font-semibold text-slate-900">
          Analysis
        </h2>
        <p className="text-xs text-slate-500">Severity returned by the active inference provider.</p>
      </div>
      <div className="px-5 py-5" aria-live="polite">
        {state.kind === "none" && (
          <p className="py-6 text-center text-sm text-slate-500">
            Not analyzed yet. <span className="font-medium text-slate-700">Analyze</span> sends this ticket to{" "}
            {providerLabel}.
          </p>
        )}
        {state.kind === "running" && (
          <div role="status" className="flex items-center justify-center gap-2 py-6 text-sm font-medium text-slate-700">
            <Spinner /> Running inference on {providerLabel}…
          </div>
        )}
        {state.kind === "error" && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-900">
              {state.error.kind === "invalid_output" ? "Model returned invalid output" : "Analysis failed"}
            </p>
            <p className="mt-1 text-sm text-red-800">{state.error.message}</p>
            {state.error.kind === "invalid_output" && (
              <p className="mt-1 text-xs text-red-800">No severity was predicted. Recorded as an invalid output in the evaluation.</p>
            )}
            {state.error.code && (
              <p className="mt-2 font-mono text-[11px] text-red-700">
                code: {state.error.code}
                {state.error.requestId ? ` · request: ${state.error.requestId}` : ""}
              </p>
            )}
            {state.error.retryable && state.error.kind !== "invalid_output" && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
              >
                Retry
              </button>
            )}
          </div>
        )}
        {state.kind === "done" && <AnalysisResult result={state.result} />}
      </div>
    </section>
  );
}

function AnalysisResult({ result }: { result: AnalysisView }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Predicted severity</span>
        <ProviderTag isMock={result.isMock} provider={result.provider} />
      </div>
      {result.severity ? (
        <SeverityBadge severity={result.severity} size="lg" />
      ) : (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">
          Invalid model output — no prediction
        </p>
      )}
      {result.isMock && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Synthetic result from the <strong>mock</strong> provider (content-blind hash rule). It is not a model
          prediction.
        </p>
      )}
      <dl className="divide-y divide-slate-100 text-sm">
        <div className="flex justify-between gap-4 py-1.5">
          <dt className="text-slate-500">Inference time</dt>
          <dd className="font-semibold tabular-nums text-slate-900">
            {result.inferenceMs !== null ? formatDuration(result.inferenceMs) : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-4 py-1.5">
          <dt className="text-slate-500">Model</dt>
          <dd className="break-all text-right font-mono text-xs text-slate-900">{result.modelId}</dd>
        </div>
        <div className="flex justify-between gap-4 py-1.5">
          <dt className="text-slate-500">Timestamp</dt>
          <dd className="text-right text-slate-900">
            <time dateTime={result.at}>{formatTimestamp(result.at)}</time>
          </dd>
        </div>
      </dl>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Post-inference evaluation</p>
        <div className="mt-2 flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 text-slate-700">
            Expected <SeverityBadge severity={result.expected} />
          </span>
          {result.correct === null ? (
            <span className="font-semibold text-red-800">✗ Invalid output</span>
          ) : result.correct ? (
            <span className="font-semibold text-emerald-800">✓ Match</span>
          ) : (
            <span className="font-semibold text-red-800">✗ Mismatch</span>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          The reference label is revealed only after inference and is never sent to the model.
        </p>
      </div>
    </div>
  );
}

export function TicketQueue() {
  const { backend, inference, refresh } = useHealthContext();
  const [view, setView] = useState<QueueView>({ kind: "loading" });
  const [analysis, setAnalysis] = useState<AnalysisState>({ kind: "none" });
  const [counters, setCounters] = useState<Counters>({ issued: 0, total: 0, analyzed: 0 });
  const [advancing, setAdvancing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const busy = useRef(false); // guards duplicate Analyze / Next clicks

  const blocked = blockedReason(backend, inference);
  const providerLabel = inference ? (inference.is_mock ? "the mock provider" : `the ${inference.provider} model`) : "the provider";

  const syncCounters = useCallback(async () => {
    try {
      const s = await getTicketSession();
      setCounters({ issued: s.issued, total: s.total, analyzed: s.analyzed });
    } catch {
      /* counters are informational; the main view reports errors */
    }
  }, []);

  const advance = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setAdvancing(true);
    try {
      const next = await getNextTicket();
      setCounters((c) => ({ ...c, issued: next.issued, total: next.total }));
      setAnalysis({ kind: "none" });
      setConfirmReset(false);
      if (next.exhausted || !next.ticket) {
        setView({ kind: "exhausted", message: next.message ?? "End of queue." });
      } else {
        setView({ kind: "ticket", ticket: next.ticket });
      }
    } catch (err) {
      setView({ kind: "error", error: asApiError(err) });
    } finally {
      busy.current = false;
      setAdvancing(false);
    }
  }, []);

  // Restore the session (without advancing) on load; start the queue if nothing was issued yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getTicketSession();
        if (cancelled) return;
        setCounters({ issued: s.issued, total: s.total, analyzed: s.analyzed });
        if (s.current) {
          // Re-show the ticket on screen (also ticket N of N); End of queue appears after Next.
          setView({ kind: "ticket", ticket: s.current });
          if (s.current_analysis) setAnalysis({ kind: "done", result: fromResult(s.current_analysis) });
        } else {
          await advance();
        }
      } catch (err) {
        if (!cancelled) setView({ kind: "error", error: asApiError(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [advance]);

  const analyze = async () => {
    if (view.kind !== "ticket" || busy.current) return;
    busy.current = true;
    setAnalysis({ kind: "running" });
    try {
      const result = await analyzeTicket(view.ticket.ticket_id);
      setAnalysis({ kind: "done", result: fromResponse(result) });
    } catch (err) {
      const error = asApiError(err);
      setAnalysis({ kind: "error", error });
      if (["network", "not_ready", "unavailable"].includes(error.kind)) refresh();
    } finally {
      busy.current = false;
      void syncCounters();
    }
  };

  const reset = async () => {
    try {
      await resetTicketSession();
      setCounters((c) => ({ ...c, issued: 0, analyzed: 0 }));
      await advance();
    } catch (err) {
      setView({ kind: "error", error: asApiError(err) });
    }
  };

  const running = analysis.kind === "running";
  const analyzed = analysis.kind === "done";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Ticket queue</h2>
          <p className="text-sm text-slate-600">
            One ticket at a time from <code className="font-mono text-xs">backend/data/tickets.jsonl</code>. Tickets
            are never repeated within a session.
          </p>
        </div>
        {inference && (
          <p className="text-sm text-slate-700">
            Active provider:{" "}
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-xs font-bold ${
                inference.is_mock ? "bg-amber-100 text-amber-950" : "bg-indigo-100 text-indigo-900"
              }`}
            >
              {inference.provider}
            </span>
          </p>
        )}
      </div>

      {view.kind === "loading" && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
          <Spinner /> Loading ticket queue…
        </div>
      )}

      {view.kind === "error" && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="font-semibold text-red-900">
            {view.error.kind === "queue_unavailable" ? "Ticket queue unavailable" : "Could not load the ticket queue"}
          </p>
          <p className="mt-1 text-sm text-red-800">{view.error.message}</p>
          <Button variant="secondary" className="mt-3" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      )}

      {view.kind === "exhausted" && (
        <section
          aria-labelledby="end-heading"
          className="rounded-xl border-2 border-slate-300 bg-white p-8 text-center shadow-sm"
        >
          <div aria-hidden="true" className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-xl">
            ■
          </div>
          <h3 id="end-heading" className="mt-3 text-lg font-semibold text-slate-900">
            End of queue
          </h3>
          <p className="mt-1 text-sm text-slate-700">{view.message}</p>
          <p className="mt-1 text-sm text-slate-500">
            {counters.analyzed} of {counters.total} tickets were analyzed. No ticket will be issued again until a new
            session is started.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              href="/evaluation"
              className="rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-800"
            >
              View evaluation
            </Link>
            {confirmReset ? (
              <>
                <Button variant="secondary" onClick={() => void reset()} className="border-red-300 text-red-800">
                  Confirm: clear results and restart
                </Button>
                <Button variant="secondary" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmReset(true)}>
                Start new session
              </Button>
            )}
          </div>
        </section>
      )}

      {view.kind === "ticket" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section
            aria-labelledby="ticket-heading"
            className="rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-7"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <p className="text-sm font-semibold text-slate-700">
                Ticket {view.ticket.position} of {view.ticket.total}
              </p>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                {view.ticket.ticket_id}
              </span>
            </div>
            <div className="space-y-3 px-5 py-5">
              <h3 id="ticket-heading" className="text-lg font-semibold text-slate-900">
                {view.ticket.title}
              </h3>
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{view.ticket.description}</p>
            </div>
            <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500" aria-live="polite">
                {blocked ?? (analyzed ? "Analyzed. Continue with Next Ticket." : "Skipped tickets are not evaluated.")}
              </p>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => void analyze()} disabled={running || analyzed || blocked !== null || advancing}>
                  {running && <Spinner light />}
                  {running ? "Analyzing…" : analyzed ? "Analyzed" : "Analyze"}
                </Button>
                <Button variant="secondary" onClick={() => void advance()} disabled={running || advancing}>
                  {advancing ? "Loading…" : "Next Ticket"}
                </Button>
              </div>
            </div>
          </section>
          <div className="space-y-6 lg:col-span-5">
            <AnalysisCard state={analysis} providerLabel={providerLabel} onRetry={() => void analyze()} />
            <ProgressCard counters={counters} />
          </div>
        </div>
      )}
    </div>
  );
}
