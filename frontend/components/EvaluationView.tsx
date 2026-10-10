"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, getEvaluation } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import type { ConfusionColumn, EvaluationResponse, Severity } from "@/lib/types";
import { SeverityBadge } from "./SeverityBadge";
import { ProviderTag } from "./TicketQueue";

// Sequential single-hue (blue) ramp for counts, light -> dark. Zero stays on the surface.
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"] as const;

export function cellStyle(count: number, max: number): { backgroundColor: string; color: string } {
  if (count === 0 || max === 0) return { backgroundColor: "#ffffff", color: "#64748b" };
  const step = Math.min(RAMP.length - 1, Math.floor((count / max) * (RAMP.length - 1) + 0.0001));
  // Dark ink on steps 0-3, white on 4-5: every cell is >= 4.9:1 (computed, not eyeballed).
  return { backgroundColor: RAMP[step], color: step >= 4 ? "#ffffff" : "#0f172a" };
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function ConfusionMatrix({ data }: { data: EvaluationResponse }) {
  const columns: ConfusionColumn[] = [...data.labels, "invalid"];
  const counts = data.labels.flatMap((e) => columns.map((p) => data.confusion_matrix[e][p]));
  const max = Math.max(0, ...counts);
  const rowTotal = (e: Severity) => columns.reduce((sum, p) => sum + data.confusion_matrix[e][p], 0);
  const colTotal = (p: ConfusionColumn) => data.labels.reduce((sum, e) => sum + data.confusion_matrix[e][p], 0);

  return (
    <section aria-labelledby="cm-heading" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h3 id="cm-heading" className="text-base font-semibold text-slate-900">
          Confusion matrix
        </h3>
        <p className="text-xs text-slate-500">
          Rows: expected severity · Columns: predicted severity · Outlined cells: correct · Darker = more tickets
        </p>
      </div>
      <div className="overflow-x-auto p-5">
        <table className="mx-auto border-separate border-spacing-[2px] text-sm">
          <caption className="sr-only">Confusion matrix of expected versus predicted severity</caption>
          <thead>
            <tr>
              <th scope="col" className="p-2 text-left text-xs font-medium text-slate-500">
                Expected ↓ / Predicted →
              </th>
              {columns.map((p) => (
                <th key={p} scope="col" className="min-w-14 p-2 text-center text-xs font-semibold text-slate-700">
                  {p === "invalid" ? "Invalid" : p}
                </th>
              ))}
              <th scope="col" className="p-2 text-center text-xs font-medium text-slate-500">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {data.labels.map((expected) => (
              <tr key={expected}>
                <th scope="row" className="p-2 text-left">
                  <SeverityBadge severity={expected} />
                </th>
                {columns.map((predicted) => {
                  const count = data.confusion_matrix[expected][predicted];
                  const diagonal = predicted === expected;
                  const label = `Expected ${expected}, predicted ${predicted === "invalid" ? "invalid output" : predicted}: ${count} ticket${count === 1 ? "" : "s"}`;
                  return (
                    <td
                      key={predicted}
                      title={label}
                      aria-label={label}
                      style={cellStyle(count, max)}
                      className={`h-12 rounded text-center font-semibold tabular-nums ${
                        diagonal ? "outline-2 -outline-offset-2 outline-slate-900" : "outline-1 -outline-offset-1 outline-slate-200"
                      }`}
                    >
                      {count}
                    </td>
                  );
                })}
                <td className="p-2 text-center tabular-nums text-slate-600">{rowTotal(expected)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="p-2 text-left text-xs font-medium text-slate-500">
                Total
              </th>
              {columns.map((p) => (
                <td key={p} className="p-2 text-center tabular-nums text-slate-600">
                  {colTotal(p)}
                </td>
              ))}
              <td className="p-2 text-center font-semibold tabular-nums text-slate-900">{data.analyzed}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResultsTable({ data }: { data: EvaluationResponse }) {
  return (
    <section aria-labelledby="rows-heading" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h3 id="rows-heading" className="text-base font-semibold text-slate-900">
          Predicted vs expected
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-5 py-2 font-medium">#</th>
              <th scope="col" className="px-3 py-2 font-medium">Ticket</th>
              <th scope="col" className="px-3 py-2 font-medium">Predicted</th>
              <th scope="col" className="px-3 py-2 font-medium">Expected</th>
              <th scope="col" className="px-3 py-2 font-medium">Result</th>
              <th scope="col" className="px-5 py-2 text-right font-medium">Inference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.results.map((r, i) => (
              <tr key={r.ticket_id}>
                <td className="px-5 py-2 tabular-nums text-slate-500">{i + 1}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-900">{r.ticket_id}</td>
                <td className="px-3 py-2">
                  {r.predicted_severity ? (
                    <SeverityBadge severity={r.predicted_severity} />
                  ) : (
                    <span className="text-xs font-semibold text-red-800">invalid output</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <SeverityBadge severity={r.expected_severity} />
                </td>
                <td className="px-3 py-2 text-xs font-semibold">
                  {r.correct === true && <span className="text-emerald-800">✓ Match</span>}
                  {r.correct === false && <span className="text-red-800">✗ Mismatch</span>}
                  {r.correct === null && <span className="text-red-800">✗ Invalid</span>}
                </td>
                <td className="px-5 py-2 text-right tabular-nums text-slate-700">
                  {r.inference_ms !== null ? formatDuration(r.inference_ms) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function EvaluationView() {
  const [data, setData] = useState<EvaluationResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getEvaluation());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("unknown", "An unexpected error occurred."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const meanMs =
    data && data.results.some((r) => r.inference_ms !== null)
      ? data.results.reduce((s, r) => s + (r.inference_ms ?? 0), 0) /
        data.results.filter((r) => r.inference_ms !== null).length
      : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Evaluation</h2>
          <p className="text-sm text-slate-600">
            Predicted versus expected severity for tickets analyzed in the current queue session.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
          <p className="font-semibold">Could not load the evaluation</p>
          <p className="mt-1 text-red-800">{error.message}</p>
        </div>
      )}

      {data && (
        <>
          {data.is_mock ? (
            <div role="status" className="mock-stripes rounded-lg border-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-bold">MOCK PROVIDER — this is not a model evaluation</p>
              <p className="mt-0.5">
                Predictions come from a content-blind synthetic rule. Agreement with the reference labels below is
                meaningless. Set <code className="font-mono text-xs">INFERENCE_PROVIDER=gemma</code> to evaluate the
                model.
              </p>
            </div>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <ProviderTag isMock={false} provider={data.provider} />
              <span className="font-mono text-xs">{data.model_id}</span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label={data.is_mock ? "Agreement (synthetic)" : "Accuracy"}
              value={data.accuracy === null ? "—" : pct(data.accuracy)}
              sub={data.analyzed ? `${data.correct} of ${data.analyzed} analyzed` : "nothing analyzed yet"}
            />
            <StatTile label="Analyzed" value={`${data.analyzed}`} sub={`of ${data.total_tickets} tickets in queue`} />
            <StatTile label="Correct" value={`${data.correct}`} sub={`${data.analyzed - data.correct - data.invalid_outputs} mismatched`} />
            <StatTile
              label="Invalid outputs"
              value={`${data.invalid_outputs}`}
              sub={meanMs !== null ? `mean inference ${formatDuration(meanMs)}` : "counted as incorrect"}
            />
          </div>

          {data.analyzed === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <p className="text-sm font-medium text-slate-700">No tickets analyzed in this session yet.</p>
              <Link href="/queue" className="mt-2 inline-block text-sm font-semibold text-sky-700 hover:underline">
                Go to the ticket queue →
              </Link>
            </div>
          ) : (
            <>
              {data.analyzed < 20 && (
                <p className="text-xs text-slate-500">
                  Small sample (n = {data.analyzed}): accuracy will change noticeably as more tickets are analyzed.
                </p>
              )}
              <ConfusionMatrix data={data} />
              <ResultsTable data={data} />
            </>
          )}
        </>
      )}
    </div>
  );
}
