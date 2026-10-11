"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, dispatchTicket, previewDispatch } from "@/lib/api";
import type { ReviewTicket } from "@/lib/integrations";
import type { DispatchPreview, DispatchRequest, DispatchResult } from "@/lib/types";
import { CONNECTOR_TILE, VendorPreview } from "./IntegrationPreviews";
import { SeverityBadge } from "./SeverityBadge";

export function dispatchRequest(ticket: ReviewTicket, connectors?: string[]): DispatchRequest {
  const a = ticket.ai_analysis;
  const i = ticket.incident;
  return {
    review_ticket_id: ticket.ticket_id,
    incident: i,
    incident_text: a.incident_text || `${i.title}. ${i.description} Business impact: ${i.business_impact}`,
    analysis: a.analysis,
    root_cause_label: a.root_cause.label,
    ai_severity: a.severity,
    approved_severity: ticket.decision?.approved_severity ?? ticket.priority,
    reviewer: ticket.decision?.reviewer ?? "",
    review_notes: ticket.decision?.notes ?? "",
    model_id: a.model_id,
    connectors: connectors ?? null,
  };
}

function Tile({ connector }: { connector: string }) {
  const t = CONNECTOR_TILE[connector] ?? { monogram: "?", tile: "bg-canvas0 text-white" };
  return (
    <span aria-hidden="true" className={`grid h-8 w-8 shrink-0 place-items-center rounded-md font-mono text-[10px] font-bold ${t.tile}`}>
      {t.monogram}
    </span>
  );
}

function SandboxBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Sandbox
    </span>
  );
}

function Receipts({ result }: { result: DispatchResult }) {
  return (
    <section aria-label="Delivery status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-sm font-semibold text-emerald-900">
        Routed to {result.route.team.name} · {result.results.length} system{result.results.length === 1 ? "" : "s"}
      </p>
      <p className="font-mono text-[11px] text-emerald-800">{result.dispatch_id}</p>
      <ol className="mt-3 space-y-2">
        {result.results.map((r, i) => (
          <li key={i} className="flex items-start gap-3 rounded-md border border-emerald-200 bg-white px-3 py-2">
            <Tile connector={r.connector} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">
                <span className="font-semibold">✓ {r.connector_name}</span> · {r.action} · {r.target}
              </p>
              <p className="font-mono text-xs text-slate-700">{r.receipt.external_ref}</p>
              <p className="text-[11px] text-muted">{r.receipt.detail}</p>
            </div>
            <SandboxBadge />
          </li>
        ))}
      </ol>
    </section>
  );
}

interface DispatchPanelProps {
  ticket: ReviewTicket;
  onDispatched: (result: DispatchResult) => void;
}

/** After approval: show the routing plan and exact messages, then send them. */
export function DispatchPanel({ ticket, onDispatched }: DispatchPanelProps) {
  const [plan, setPlan] = useState<DispatchPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const request = useMemo(() => dispatchRequest(ticket), [ticket]);

  useEffect(() => {
    if (ticket.dispatch) return;
    let cancelled = false;
    previewDispatch(request)
      .then((p) => !cancelled && setPlan(p))
      .catch((e: unknown) => !cancelled && setError(e instanceof ApiError ? e.message : "Could not build the routing plan."));
    return () => {
      cancelled = true;
    };
  }, [request, ticket.dispatch]);

  if (ticket.dispatch) return <Receipts result={ticket.dispatch} />;
  if (error)
    return (
      <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
        {error}
      </p>
    );
  if (!plan) return <p className="text-sm text-muted">Building routing plan…</p>;

  const connectors = [...new Set(plan.deliveries.map((d) => d.connector))];
  const selected = connectors.filter((c) => !excluded.has(c));
  const toggle = (c: string) =>
    setExcluded((s) => {
      const next = new Set(s);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      onDispatched(await dispatchTicket(dispatchRequest(ticket, selected)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Routing failed.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section aria-label="Route to owning team" className="space-y-4">
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-signal-strong">Routing plan</p>
        <p className="mt-1 text-base font-semibold text-ink">
          {plan.route.team.name} <SeverityBadge severity={plan.route.severity} />
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-slate-800">
          <li>{plan.route.owner_reason}</li>
          <li>{plan.route.severity_reason}</li>
        </ul>
        <p className="mt-2 text-xs text-slate-600">
          Slack {plan.route.team.slack_channel} · Jira {plan.route.team.jira_project} · ServiceNow {plan.route.team.servicenow_group}
        </p>
      </div>

      <ol className="space-y-4">
        {plan.deliveries.map((d, i) => {
          const on = !excluded.has(d.connector);
          return (
            <li key={`${d.connector}-${i}`} className={`rounded-lg border p-3 ${on ? "border-slate-300 bg-white" : "border-dashed border-slate-300 bg-canvas opacity-60"}`}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Tile connector={d.connector} />
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {d.connector_name} · {d.action}
                    </p>
                    <p className="text-xs text-slate-600">{d.target}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <SandboxBadge />
                  <label className="flex items-center gap-1.5 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(d.connector)}
                      className="h-4 w-4 accent-signal"
                      aria-label={`Send to ${d.connector_name} (${d.target})`}
                    />
                    Send
                  </label>
                </div>
              </div>
              <VendorPreview delivery={d} />
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">API request</summary>
                <p className="mt-1 font-mono text-[11px] text-slate-700">
                  {d.method} {d.endpoint}
                </p>
                <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-200">
                  {JSON.stringify(d.payload, null, 2)}
                </pre>
              </details>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">
          Integrations run in sandbox mode: requests are recorded in the outbox until live credentials are configured
          (see Integrations).
        </p>
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || selected.length === 0}
          className="rounded-full bg-signal px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-signal-strong disabled:bg-slate-400"
        >
          {sending ? "Routing…" : `Route to ${plan.route.team.name} (${selected.length} system${selected.length === 1 ? "" : "s"})`}
        </button>
      </div>
    </section>
  );
}
