"use client";

import { useEffect, useState } from "react";
import { ApiError, getTriageEvaluation } from "@/lib/api";
import type { Metric, TriageEvaluationResponse } from "@/lib/types";

// Rows in display order; labels for keys the backend may return. Unknown keys are
// shown with their raw name rather than dropped.
const METRIC_LABELS: Record<string, string> = {
  valid_json: "Valid JSON rate",
  category: "Category exact match",
  severity: "Severity exact match",
  root_cause: "Root-cause exact match",
};

const pct = (m: Metric | undefined) => (m ? `${(m.accuracy * 100).toFixed(1)}%` : "—");

function Bar({ metric }: { metric: Metric | undefined }) {
  if (!metric) return null;
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <div className="h-full rounded-full bg-sky-600" style={{ width: `${metric.accuracy * 100}%` }} />
    </div>
  );
}

/** Offline evaluation of the five-field triage adapter. Shows only shipped metrics. */
export function TriageEvaluation() {
  const [data, setData] = useState<TriageEvaluationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getTriageEvaluation(controller.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : "Could not load the full-triage evaluation.");
      });
    return () => controller.abort();
  }, []);

  const keys = data?.fine_tuned
    ? [...Object.keys(METRIC_LABELS).filter((k) => k in data.fine_tuned!), ...Object.keys(data.fine_tuned).filter((k) => !(k in METRIC_LABELS))]
    : [];
  const n = data?.fine_tuned ? Math.max(...Object.values(data.fine_tuned).map((m) => m.total)) : null;

  return (
    <section aria-labelledby="triage-eval-heading" className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="border-b border-line px-5 py-4">
        <h3 id="triage-eval-heading" className="text-base font-semibold text-ink">
          Full incident triage (five-field adapter) · offline evaluation
        </h3>
        <p className="text-xs text-muted">
          Separate from the live severity session above. Numbers are read from the evaluation file shipped with the
          adapter; nothing here is estimated.
        </p>
      </div>
      <div className="px-5 py-5">
        {!data && !error && <p className="text-sm text-muted">Loading…</p>}
        {error && (
          <p role="status" className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-slate-700">
            Unavailable: {error}
          </p>
        )}
        {data && !data.available && (
          <p role="status" className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-slate-700">
            Unavailable: {data.detail}
          </p>
        )}
        {data?.available && data.fine_tuned && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Adapter <span className="font-mono text-xs font-semibold">{data.adapter}</span>
              {n !== null && <> · held-out synthetic test set, n = {n}</>}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Base model versus fine-tuned adapter on the held-out test set</caption>
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="py-2 text-left font-medium">Metric</th>
                    <th scope="col" className="w-40 py-2 text-left font-medium">Base model</th>
                    <th scope="col" className="w-40 py-2 text-left font-medium">Fine-tuned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {keys.map((k) => (
                    <tr key={k}>
                      <th scope="row" className="py-2 pr-4 text-left font-medium text-slate-800">{METRIC_LABELS[k] ?? k}</th>
                      <td className="py-2 pr-4 tabular-nums text-slate-600">
                        {pct(data.base_model?.[k])}
                        <Bar metric={data.base_model?.[k]} />
                      </td>
                      <td className="py-2 pr-4 font-semibold tabular-nums text-ink">
                        {pct(data.fine_tuned![k])}
                        <Bar metric={data.fine_tuned![k]} />
                      </td>
                    </tr>
                  ))}
                  {data.not_measured.map((label) => (
                    <tr key={label}>
                      <th scope="row" className="py-2 pr-4 text-left font-medium text-slate-800">{label.split(" (")[0]}</th>
                      <td colSpan={2} className="py-2 text-xs text-muted">Not measured — no labelled evaluation exists</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">
              {data.detail} Source: <code className="font-mono">{data.source}</code>. Synthetic, template-based test
              data: real-world accuracy has not been measured.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
