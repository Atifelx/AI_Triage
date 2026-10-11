"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import {
  ApiError,
  analyzeTicket,
  analyzeTicketFull,
  getEvaluation,
  getNextTicket,
  getTicketSession,
  resetTicketSession,
} from "@/lib/api";
import { formatDuration, formatTimestamp } from "@/lib/format";
import type {
  EvaluationResponse,
  FullTriageResponse,
  Severity,
  Ticket,
  TicketAnalysisResponse,
  TicketResult,
  TriageRequest,
} from "@/lib/types";

/** Incident for the review ticket: the ticket's structured fields, or its text when it has none. */
function reviewIncident(ticket: Ticket): TriageRequest {
  return (
    ticket.incident ?? {
      title: ticket.title,
      description: ticket.description,
      affected_service: "Not specified",
      affected_users: 0,
      affected_departments: [],
      affected_sites: [],
      business_impact: "See the ticket description.",
      workaround_available: null,
      diagnostic_evidence: "",
    }
  );
}
import { ModeCard, useAnalysisMode } from "./AnalysisMode";
import { PageHeader, PageLayout, RailCard } from "./PageLayout";
import { blockedReason, useHealthContext } from "./AppShell";
import { FullTriageResult, type Reference } from "./FullTriageResult";
import { MockLabel } from "./ResultPanel";
import { ReviewModal } from "./ReviewModal";
import { useReviewStore } from "./ReviewStore";
import { autoReview } from "@/lib/integrations";
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
  | { kind: "full"; triage: FullTriageResponse; reference: Reference }
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
      ? "bg-signal text-white hover:bg-signal-strong disabled:bg-slate-400 focus-visible:outline-signal"
      : "border border-slate-300 bg-white text-slate-800 hover:bg-canvas disabled:text-slate-400 focus-visible:outline-signal";
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-right">
        <span className="text-sm font-semibold tabular-nums text-ink">{value}</span>
        {sub && <span className="block text-[11px] text-muted">{sub}</span>}
      </span>
    </div>
  );
}

function SessionCard({ counters, stats }: { counters: Counters; stats: EvaluationResponse | null }) {
  const pct = counters.total ? Math.round((counters.issued / counters.total) * 100) : 0;
  const rate = (m?: { correct: number; total: number }) =>
    m && m.total ? `${Math.round((m.correct / m.total) * 100)}%` : "—";
  const fm = stats?.field_metrics;
  return (
    <RailCard title="This session">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label="Tickets issued"
        aria-valuemin={0}
        aria-valuemax={counters.total}
        aria-valuenow={counters.issued}
      >
        <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs tabular-nums text-muted">
        {counters.issued} of {counters.total} issued · {counters.analyzed} analyzed
      </p>
      {stats && stats.analyzed > 0 && (
        <div className="mt-3 divide-y divide-line border-t border-line">
          <Stat label="Severity" value={rate({ correct: stats.correct, total: stats.analyzed })} sub={`${stats.correct} of ${stats.analyzed}`} />
          {fm?.category && fm.category.total > 0 && <Stat label="Category" value={rate(fm.category)} sub={`${fm.category.correct} of ${fm.category.total}`} />}
          {fm?.root_cause && fm.root_cause.total > 0 && <Stat label="Root cause" value={rate(fm.root_cause)} sub={`${fm.root_cause.correct} of ${fm.root_cause.total}`} />}
        </div>
      )}
      <Link href="/evaluation" className="mt-3 inline-block text-xs font-semibold text-signal hover:underline">
        Open evaluation
      </Link>
    </RailCard>
  );
}

function AnalysisCard({
  state,
  providerLabel,
  onRetry,
  onSendForReview,
}: {
  state: AnalysisState;
  providerLabel: string;
  onRetry: () => void;
  onSendForReview?: () => void;
}) {
  return (
    <section aria-labelledby="analysis-heading" className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="border-b border-line px-5 py-4">
        <h2 id="analysis-heading" className="text-base font-semibold text-ink">
          Analysis
        </h2>
        <p className="text-xs text-muted">
          {state.kind === "full" ? "Full five-field analysis from the triage adapter." : "Result from the active inference provider."}
        </p>
      </div>
      <div className="px-6 py-5" aria-live="polite">
        {state.kind === "none" && (
          <p className="py-6 text-center text-sm text-muted">
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
        {state.kind === "full" && (
          <FullTriageResult result={state.triage} reference={state.reference} onSendForReview={onSendForReview} />
        )}
      </div>
    </section>
  );
}

function AnalysisResult({ result }: { result: AnalysisView }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Predicted severity</span>
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
      <dl className="divide-y divide-line text-sm">
        <div className="flex justify-between gap-4 py-1.5">
          <dt className="text-muted">Inference time</dt>
          <dd className="font-semibold tabular-nums text-ink">
            {result.inferenceMs !== null ? formatDuration(result.inferenceMs) : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-4 py-1.5">
          <dt className="text-muted">Model</dt>
          <dd className="break-all text-right font-mono text-xs text-ink">{result.modelId}</dd>
        </div>
        <div className="flex justify-between gap-4 py-1.5">
          <dt className="text-muted">Timestamp</dt>
          <dd className="text-right text-ink">
            <time dateTime={result.at}>{formatTimestamp(result.at)}</time>
          </dd>
        </div>
      </dl>
      <div className="rounded-md border border-line bg-canvas p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Post-inference evaluation</p>
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
        <p className="mt-2 text-[11px] text-muted">
          The reference label is revealed only after inference and is never sent to the model.
        </p>
      </div>
    </div>
  );
}

export function TicketQueue() {
  const { backend, inference, refresh } = useHealthContext();
  const { mode } = useAnalysisMode();
  const [stats, setStats] = useState<EvaluationResponse | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { addTicket } = useReviewStore();
  const [notice, setNotice] = useState<string | null>(null);
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
      setStats(await getEvaluation());
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
      setNotice(null);
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
        getEvaluation()
          .then((e) => !cancelled && setStats(e))
          .catch(() => undefined); // session stats are informational
        if (s.current) {
          // Re-show the ticket on screen (also ticket N of N); End of queue appears after Next.
          setView({ kind: "ticket", ticket: s.current });
          const ca = s.current_analysis;
          if (ca?.triage) {
            setAnalysis({
              kind: "full",
              triage: ca.triage,
              reference: { severity: ca.expected_severity, category: ca.expected_category ?? null, root_cause: ca.expected_root_cause ?? null, source: `ticket ${ca.ticket_id}` },
            });
          } else if (ca) setAnalysis({ kind: "done", result: fromResult(ca) });
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
      if (mode === "full") {
        const r = await analyzeTicketFull(view.ticket.ticket_id);
        // Every full analysis goes to Reviews for a human decision.
        const review = addTicket(autoReview(reviewIncident(view.ticket), r.triage, "Ticket queue", view.ticket.ticket_id));
        setNotice(`Added to Reviews as ${review.ticket_id} (pending review).`);
        setAnalysis({
          kind: "full",
          triage: r.triage,
          reference: { severity: r.expected_severity, category: r.expected_category, root_cause: r.expected_root_cause, source: `ticket ${r.ticket_id}` },
        });
      } else {
        const result = await analyzeTicket(view.ticket.ticket_id);
        setAnalysis({ kind: "done", result: fromResponse(result) });
      }
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
  const analyzed = analysis.kind === "done" || analysis.kind === "full";

  return (
    <PageLayout
      header={
        <PageHeader
          title="Ticket queue"
          description={`${counters.total || 120} held-out service-desk tickets the model never trained on, one at a time. Each result is checked against the ticket's dataset label after inference.`}
        />
      }
      aside={
        <>
          <ModeCard inference={inference} disabled={running} />
          <SessionCard counters={counters} stats={stats} />
        </>
      }
    >

      {view.kind === "loading" && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-line bg-white p-6 text-sm text-slate-700">
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
          <h3 id="end-heading" className="mt-3 text-lg font-semibold text-ink">
            End of queue
          </h3>
          <p className="mt-1 text-sm text-slate-700">{view.message}</p>
          <p className="mt-1 text-sm text-muted">
            {counters.analyzed} of {counters.total} tickets were analyzed. No ticket will be issued again until a new
            session is started.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              href="/evaluation"
              className="rounded-full bg-signal px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-signal-strong"
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
        <div className="space-y-6">
          <section
            aria-labelledby="ticket-heading"
            className="rounded-2xl border border-line bg-surface shadow-card"
          >
            <div className="flex flex-col gap-3 border-b border-line px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <p className="text-sm font-semibold text-slate-700">
                  Ticket {view.ticket.position} of {view.ticket.total}
                </p>
                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">{view.ticket.ticket_id}</span>
              </div>
            </div>
            <div className="space-y-3 px-6 py-5">
              <h3 id="ticket-heading" className="text-lg font-semibold text-ink">
                {view.ticket.title}
              </h3>
              <p className="max-w-5xl whitespace-pre-wrap text-sm leading-6 text-slate-800">{view.ticket.description}</p>
            </div>
            <div className="flex flex-col gap-3 border-t border-line px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted" aria-live="polite">
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
          {notice && (
            <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <span>
                {notice}{" "}
                <Link href="/reviews" className="font-semibold underline">
                  Open Reviews
                </Link>
              </span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-emerald-800 hover:text-emerald-950">
                ×
              </button>
            </div>
          )}
          <AnalysisCard
            state={analysis}
            providerLabel={providerLabel}
            onRetry={() => void analyze()}
            onSendForReview={analysis.kind === "full" ? () => setReviewOpen(true) : undefined}
          />
          {reviewOpen && analysis.kind === "full" && (
            <ReviewModal
              incident={reviewIncident(view.ticket)}
              result={analysis.triage}
              source="Ticket queue"
              sourceRef={view.ticket.ticket_id}
              onClose={() => setReviewOpen(false)}
              onSubmitted={(ticket) => {
                setReviewOpen(false);
                setNotice(`Review ticket ${ticket.ticket_id} sent to ${ticket.queue} (${ticket.destination_name}).`);
              }}
            />
          )}
        </div>
      )}

    </PageLayout>
  );
}
