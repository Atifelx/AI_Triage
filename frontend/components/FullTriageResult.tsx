"use client";

import { useState, type ReactNode } from "react";
import { formatDuration, formatTimestamp } from "@/lib/format";
import { severityText } from "@/lib/severity";
import type { FullTriageResponse, Severity } from "@/lib/types";
import { MockLabel } from "./ResultPanel";
import { SeverityLadder } from "./SeverityLadder";

export const ACTIONS_NOTICE =
  "AI-generated recommendations. Human review and authorization are required before taking action.";

const humanize = (id: string) => id.replace(/_/g, " ");

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed — select the text" : "Copy JSON"}
    </button>
  );
}

/** Minimal JSON syntax colouring (no dependency). Operates on JSON.stringify output only. */
function HighlightedJson({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const parts = text.split(/("(?:[^"\\]|\\.)*"(?=\s*:)|"(?:[^"\\]|\\.)*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?)/g);
  return (
    <pre className="max-h-80 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-200">
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        const isKey = /^"/.test(part) && /^\s*:/.test(parts[i + 1] ?? "");
        const cls = isKey
          ? "text-sky-300"
          : part.startsWith('"')
            ? "text-emerald-300"
            : "text-amber-300";
        return (
          <span key={i} className={cls}>
            {part}
          </span>
        );
      })}
    </pre>
  );
}

/** Splits `text` into plain and highlighted runs for every exact (case-insensitive) evidence match. */
function highlight(text: string, phrases: string[]): { text: string; hit: boolean }[] {
  const ranges: [number, number][] = [];
  const lower = text.toLowerCase();
  for (const phrase of phrases) {
    const p = phrase.trim().replace(/[.]+$/, "").toLowerCase();
    if (p.length < 4) continue;
    const at = lower.indexOf(p);
    if (at >= 0) ranges.push([at, at + p.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const runs: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const [from, to] of ranges) {
    if (to <= pos) continue;
    const start = Math.max(from, pos);
    if (start > pos) runs.push({ text: text.slice(pos, start), hit: false });
    runs.push({ text: text.slice(start, to), hit: true });
    pos = to;
  }
  if (pos < text.length) runs.push({ text: text.slice(pos), hit: false });
  return runs;
}

function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  );
}

const ICON = {
  search: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM13.5 13.5 17 17",
  info: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 9v4M10 6.5v.01",
  check: "M4.5 10.5l3.5 3.5 7.5-8",
  spark: "M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6zM15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  lock: "M6 9V7a4 4 0 1 1 8 0v2M5 9h10v8H5z",
};

/** Root cause (orange: AI hypothesis), why (grey: explanation), proof (green: stated / amber: inferred). */
function RootCauseProof({ result }: { result: FullTriageResponse }) {
  const { analysis, root_cause: rc } = result;
  const label = rc.label ?? humanize(analysis.root_cause);
  const stated = result.evidence_support.filter((e) => e.found_in_incident);
  const runs = result.incident_text ? highlight(result.incident_text, stated.map((e) => e.text)) : [];
  const highlighted = runs.some((r) => r.hit);
  return (
    <section aria-labelledby="sec-rca" className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      {/* Hypothesis */}
      <div className="border-l-4 border-orange-500 bg-orange-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="sec-rca" className="flex items-center gap-1.5 text-sm font-semibold text-orange-800">
            <Icon d={ICON.search} />
            Root Cause Analysis
          </h3>
          <span className="rounded-full border border-orange-200 bg-white px-2 py-0.5 text-[11px] font-medium text-orange-800">
            AI hypothesis · confirm before acting
          </span>
        </div>
        <p className="mt-1.5 text-lg font-semibold text-ink">{label}</p>
        <p className="font-mono text-xs text-orange-900/70">
          {analysis.root_cause} · category {analysis.category}
        </p>
      </div>

      <div className="space-y-4 p-4">
        {/* Why */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Icon d={ICON.info} />
            Why this root cause?
          </p>
          {rc.definition ? (
            <p className="mt-1 text-sm text-slate-800">
              <span className="font-semibold">{label}</span> means: {rc.definition}{" "}
              {stated.length > 0
                ? `The ticket states ${stated.length === 1 ? "a fact" : `${stated.length} facts`} that match this — see the proof below.`
                : "None of the model's proof was found in the ticket text, so this link is unverified."}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-800">
              This root cause is not in the adapter&apos;s training taxonomy, so there is no definition to check it against.
            </p>
          )}
          {rc.matches_category === false && (
            <p className="mt-1 text-xs font-semibold text-orange-800">
              Inconsistent: this cause belongs to {rc.taxonomy_category}, not {analysis.category}.
            </p>
          )}
        </div>

        {/* Proof */}
        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink">Proof</p>
          {result.evidence_support.length === 0 ? (
            <p className="text-xs text-muted">The model returned no proof.</p>
          ) : (
            <ul className="space-y-2">
              {result.evidence_support.map((item, i) => (
                <li
                  key={i}
                  className={`flex flex-col gap-1.5 rounded-lg border-l-4 px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3 ${
                    item.found_in_incident ? "border-emerald-500 bg-emerald-50/70" : "border-amber-400 bg-amber-50/70"
                  }`}
                >
                  <span className="text-sm text-slate-800">“{item.text}”</span>
                  {item.found_in_incident ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                      <Icon d={ICON.check} className="h-3 w-3" />
                      Stated in incident
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                      Model inference
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {highlighted && (
          <details className="rounded-lg border border-line px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">
              Show where the proof appears in the ticket
            </summary>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {runs.map((r, i) =>
                r.hit ? (
                  <mark key={i} className="rounded bg-emerald-100 px-0.5 font-medium text-emerald-900 ring-1 ring-emerald-200">
                    {r.text}
                  </mark>
                ) : (
                  <span key={i}>{r.text}</span>
                ),
              )}
            </p>
            <p className="mt-1 text-[11px] text-muted">Exact text the model received. Green: proof quoted by the model.</p>
          </details>
        )}
        <p className="text-[11px] text-muted">
          Based only on the submitted ticket. No logs, Microsoft Graph or monitoring systems were queried.
        </p>
      </div>
    </section>
  );
}

/** AI next steps: Apple blue (the action colour) with a travelling ring, apart from facts (green) and hypotheses (orange). */
function Recommendations({
  actions,
  checks,
  onToggle,
}: {
  actions: string[];
  checks: boolean[];
  onToggle: (i: number) => void;
}) {
  const done = checks.filter(Boolean).length;
  return (
    <div className="ring-animated shadow-card">
    <section aria-labelledby="sec-recommended-actions" className="overflow-hidden rounded-[calc(0.875rem-1.5px)] bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-signal px-4 py-3 text-white">
        <div>
          <h3 id="sec-recommended-actions" className="flex items-center gap-1.5 text-sm font-semibold">
            <Icon d={ICON.spark} />
            Recommended Actions
          </h3>
          <p className="text-xs text-white/80">Next steps suggested by the triage adapter</p>
        </div>
        {actions.length > 0 && (
          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium tabular-nums">
            {done} of {actions.length} reviewed
          </span>
        )}
      </div>
      <p role="note" className="flex items-start gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900">
        <Icon d={ICON.lock} className="mt-px shrink-0" />
        {ACTIONS_NOTICE}
      </p>
      {actions.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted">The model returned no recommended actions.</p>
      ) : (
        <ol className="divide-y divide-blue-100">
          {actions.map((action, i) => (
            <li key={i}>
              <label className={`flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors ${checks[i] ? "bg-emerald-50/60" : "hover:bg-signal/5"}`}>
                <span
                  aria-hidden="true"
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                    checks[i] ? "bg-emerald-600 text-white" : "bg-signal/10 text-signal-strong"
                  }`}
                >
                  {checks[i] ? "✓" : i + 1}
                </span>
                <span className={`min-w-0 flex-1 text-sm ${checks[i] ? "text-muted line-through" : "text-ink"}`}>{action}</span>
                <input
                  type="checkbox"
                  checked={checks[i] ?? false}
                  onChange={() => onToggle(i)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-signal"
                  aria-label={`Mark action ${i + 1} as reviewed`}
                />
              </label>
            </li>
          ))}
        </ol>
      )}
      <p className="border-t border-blue-100 px-4 py-2 text-[11px] text-muted">
        Ticking a step is a local review note. Nothing is executed.
      </p>
    </section>
    </div>
  );
}

export interface Reference {
  severity: string;
  category: string | null;
  root_cause: string | null;
  /** Where the label comes from, e.g. "held-out example ITSM-05-003". */
  source: string;
}

interface FullTriageResultProps {
  result: FullTriageResponse;
  onSendForReview?: () => void;
  /** Dataset label to compare against (examples / queue). Never sent to the model. */
  reference?: Reference | null;
}

function Match({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="font-semibold text-emerald-700">Match</span>
  ) : (
    <span className="font-semibold text-red-700">Mismatch</span>
  );
}

function ReferenceCheck({ result, reference }: { result: FullTriageResponse; reference: Reference }) {
  const a = result.analysis;
  const rows: [string, string, string | null][] = [
    ["Severity", result.severity ?? a.severity, reference.severity],
    ["Category", a.category, reference.category],
    ["Root cause", a.root_cause, reference.root_cause],
  ];
  return (
    <section aria-label="Reference check" className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
      <p className="text-sm font-semibold text-ink">Reference check</p>
      <p className="text-xs text-muted">Dataset label for {reference.source}, revealed after inference.</p>
      <table className="mt-2 w-full table-fixed text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="w-24 py-1 font-medium">Field</th>
            <th className="py-1 font-medium">Model</th>
            <th className="py-1 font-medium">Reference</th>
            <th className="w-20 py-1" />
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, model, ref]) => (
            <tr key={label} className="border-t border-emerald-100">
              <td className="py-1.5 text-muted">{label}</td>
              <td className="break-words py-1.5 pr-2 font-mono text-xs">{model}</td>
              <td className="break-words py-1.5 pr-2 font-mono text-xs">{ref ?? "—"}</td>
              <td className="py-1.5 text-right text-xs">{ref ? <Match ok={model === ref} /> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Small model/run details: the "information layer" at the bottom of a result. */
export function InfoLayer({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 border-t border-line pt-3 text-[11px] leading-4 text-muted sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="flex min-w-0 gap-2">
          <dt className="shrink-0">{label}</dt>
          <dd className="min-w-0 break-all font-mono text-slate-600">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FullTriageResult({ result, onSendForReview, reference }: FullTriageResultProps) {
  const { analysis } = result;
  // Local review state only: ticking a box never runs anything.
  const [reviewed, setReviewed] = useState<Record<string, boolean[]>>({});
  const checks = reviewed[result.request_id] ?? analysis.recommended_actions.map(() => false);
  const toggle = (i: number) =>
    setReviewed((all) => ({ ...all, [result.request_id]: checks.map((v, j) => (j === i ? !v : v)) }));
  const severity = result.severity ?? analysis.severity;
  const fromSeverityAdapter = result.severity_source === "severity_adapter";
  const triageDiffers = result.triage_severity && result.triage_severity !== severity;

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {result.is_mock && <MockLabel />}
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-medium text-slate-700">
              {analysis.category}
            </span>
          </div>
          <h3 className="text-xl font-semibold leading-snug text-ink">{result.incident_title}</h3>
          <p className="sr-only">Severity: {severityText(severity)}</p>
          <p className="max-w-3xl text-sm text-slate-700">
            {fromSeverityAdapter ? "Severity from the dedicated severity adapter." : "Severity from the triage adapter."}{" "}
            {triageDiffers && <>The triage adapter alone suggested {result.triage_severity}.</>}
          </p>
        </div>
        {onSendForReview && (
          <button
            type="button"
            onClick={onSendForReview}
            className="shrink-0 rounded-full bg-signal px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-signal-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Send for Review
          </button>
        )}
      </div>

      {(result.uncertain || result.is_mock) && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {result.uncertain && (
            <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-semibold">Treat this analysis as uncertain</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                {result.uncertainty_notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          )}
          {result.is_mock && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
              Synthetic result from the <strong>mock</strong> provider (keyword rules). It was not produced by Gemma
              or any model.
            </p>
          )}
        </div>
      )}

      {/* Severity | Root cause & proof */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section aria-label="Severity" className="min-w-0 lg:col-span-4">
          <h4 className="mb-2 text-sm font-semibold text-ink">Severity</h4>
          <SeverityLadder
            predicted={severity}
            check={triageDiffers ? result.triage_severity : null}
            reference={(reference?.severity as Severity) ?? null}
          />
        </section>
        <div className="min-w-0 lg:col-span-8">
          <RootCauseProof result={result} />
        </div>
      </div>

      {/* Actions | Reference check */}
      <div className={`grid grid-cols-1 gap-6 ${reference ? "lg:grid-cols-2" : ""}`}>
        <div className="min-w-0">
          <Recommendations actions={analysis.recommended_actions} checks={checks} onToggle={toggle} />
        </div>
        {reference && (
          <div className="min-w-0">
            <ReferenceCheck result={result} reference={reference} />
          </div>
        )}
      </div>

      <details className="rounded-lg border border-line bg-surface px-4 py-2.5">
        <summary className="cursor-pointer text-sm font-medium text-ink">View Raw JSON</summary>
        <div className="mt-3 min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">Triage adapter output, validated, exactly as returned by the API.</p>
            <CopyButton text={JSON.stringify(analysis, null, 2)} />
          </div>
          <HighlightedJson value={analysis} />
          {result.raw_output != null && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Raw generated text (development mode)</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-canvas p-3 font-mono text-[11px] text-slate-800">
                {result.raw_output}
              </pre>
            </div>
          )}
        </div>
      </details>

      <InfoLayer
        items={[
          ["Triage", <span key="m">{result.model_id}</span>],
          ["Severity", result.severity_check ? result.severity_check.model_id : "triage adapter"],
          ["Inference", formatDuration(result.inference_ms)],
          ["Time", <time key="t" dateTime={result.created_at}>{formatTimestamp(result.created_at)}</time>],
          ["Provider", `${result.provider}${result.is_mock ? " (synthetic)" : ""}`],
          ["Request", result.request_id],
        ]}
      />
    </div>
  );
}
