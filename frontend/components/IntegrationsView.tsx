"use client";

import { useEffect, useState } from "react";
import { ApiError, getIntegrations } from "@/lib/api";
import type { IntegrationsCatalog, Severity } from "@/lib/types";
import { CONNECTOR_TILE } from "./IntegrationPreviews";
import { PageHeader, PageLayout, RailCard } from "./PageLayout";
import { SeverityBadge } from "./SeverityBadge";

const SEVERITIES: Severity[] = ["P1", "P2", "P3", "P4"];

/** Connectors, routing rules and the steps to connect each live workspace. */
export function IntegrationsView() {
  const [data, setData] = useState<IntegrationsCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getIntegrations(controller.signal)
      .then(setData)
      .catch((e: unknown) => !controller.signal.aborted && setError(e instanceof ApiError ? e.message : "Could not load integrations."));
    return () => controller.abort();
  }, []);

  if (error)
    return (
      <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-muted">Loading integrations…</p>;

  const name = (id: string) => data.connectors.find((c) => c.id === id)?.name ?? id;

  return (
    <PageLayout
      header={
        <PageHeader
          title="Integrations"
          description="After a human approves a triaged incident, it is routed to the owning team's systems. Each connector builds the exact vendor API request."
        />
      }
      aside={
        <>
          <RailCard title="Connection">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-sky-500" /> Sandbox
            </p>
            <p className="mt-1 text-xs text-slate-700">
              Requests are recorded in the outbox, not sent, until live credentials are configured for a connector.
            </p>
          </RailCard>
          <RailCard title="How a ticket flows">
            <ol className="space-y-2.5">
              {[
                ["AI triage", "Category, root cause, proof and actions from the triage adapter; severity from the severity adapter."],
                ["Send for review", "An engineer routes the ticket to a review queue."],
                ["Human decision", "A reviewer approves or rejects and sets the final severity."],
                ["Routing rules", "Category picks the owning team; final severity picks the systems."],
                ["Delivery", "Each system receives the incident in its own format, with a receipt."],
              ].map(([title, text], i) => (
                <li key={title} className="flex gap-2.5">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-signal/10 text-[11px] font-semibold text-signal-strong">
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-xs font-semibold text-ink">{title}</span>
                    <span className="block text-xs text-muted">{text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </RailCard>
        </>
      }
    >
      <section aria-labelledby="rules-heading" className="rounded-2xl border border-line bg-surface shadow-card">
        <div className="border-b border-line px-5 py-4">
          <h3 id="rules-heading" className="text-base font-semibold text-ink">Routing rules</h3>
          <p className="text-xs text-muted">Final (human-approved) severity → systems notified</p>
        </div>
        <ul className="divide-y divide-line">
          {SEVERITIES.map((s) => (
            <li key={s} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
              <SeverityBadge severity={s} />
              <div className="flex-1">
                <p className="text-sm text-slate-800">{data.severity_reasons[s]}</p>
                <p className="mt-1 flex flex-wrap gap-1">
                  {data.severity_rules[s].map((c) => (
                    <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{name(c)}</span>
                  ))}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="teams-heading" className="rounded-2xl border border-line bg-surface shadow-card">
        <div className="border-b border-line px-5 py-4">
          <h3 id="teams-heading" className="text-base font-semibold text-ink">Team directory</h3>
          <p className="text-xs text-muted">AI category → owning team and its destinations</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-muted">
              <tr>
                {["Team", "Categories", "Slack", "Teams channel", "Jira", "ServiceNow group"].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-4 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.teams.map((t) => (
                <tr key={t.key}>
                  <td className="px-4 py-2 font-medium text-ink">{t.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{t.categories.join(", ")}</td>
                  <td className="px-4 py-2 font-mono text-xs">{t.slack_channel}</td>
                  <td className="px-4 py-2 text-xs">{t.teams_channel}</td>
                  <td className="px-4 py-2 font-mono text-xs">{t.jira_project}</td>
                  <td className="px-4 py-2 text-xs">{t.servicenow_group}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="conn-heading" className="space-y-3">
        <h3 id="conn-heading" className="text-base font-semibold text-ink">Connectors</h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.connectors.map((c) => {
            const tile = CONNECTOR_TILE[c.id];
            return (
              <article key={c.id} className="rounded-xl border border-line bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className={`grid h-10 w-10 place-items-center rounded-lg font-mono text-[11px] font-bold ${tile?.tile}`}>
                      {tile?.monogram}
                    </span>
                    <div>
                      <h4 className="font-semibold text-ink">{c.name}</h4>
                      <p className="text-xs text-muted">{c.vendor_api}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Sandbox
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-600">
                  Used for {c.used_for.join(", ")} incidents.
                </p>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Connect a live workspace</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-slate-800">
                  {c.go_live_steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                  <li>
                    Set{" "}
                    {c.go_live_env.map((e, i) => (
                      <span key={e}>
                        <code className="rounded bg-slate-100 px-1 font-mono text-xs">{e}</code>
                        {i < c.go_live_env.length - 1 ? ", " : ""}
                      </span>
                    ))}{" "}
                    in <code className="rounded bg-slate-100 px-1 font-mono text-xs">backend/.env</code> and restart the API.
                  </li>
                </ol>
              </article>
            );
          })}
        </div>
        <p className="text-xs text-muted">
          Live sending is not implemented yet: the connectors already build the vendor payloads; going live adds the
          HTTP call and credential handling in <code className="font-mono">backend/app/services/integrations/connectors.py</code>.
        </p>
      </section>
    </PageLayout>
  );
}
