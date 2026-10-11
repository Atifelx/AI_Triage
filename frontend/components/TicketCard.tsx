import { SEVERITY_META } from "@/lib/severity";
import type { FullTriageResponse, Severity, TriageRequest } from "@/lib/types";
import { SeverityBadge } from "./SeverityBadge";

interface TicketCardProps {
  ticketId: string;
  status: string;
  priority: Severity;
  destination: string;
  queue: string;
  summary: string;
  notes?: string;
  incident: TriageRequest;
  analysis: FullTriageResponse;
  createdAt?: string;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

/** An incident ticket rendered the way an ITSM tool shows it (header, fields, body). */
export function TicketCard(props: TicketCardProps) {
  const { incident, analysis } = props;
  const a = analysis.analysis;
  const workaround =
    incident.workaround_available === null ? "Unknown" : incident.workaround_available ? "Yes" : "No";
  return (
    <article className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm" aria-label={`Ticket ${props.ticketId}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-ink">{props.ticketId}</span>
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-900">{props.status}</span>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-slate-600">
          Priority <SeverityBadge severity={props.priority} /> {SEVERITY_META[props.priority].label}
        </span>
      </header>
      <div className="space-y-4 px-4 py-4">
        <h3 className="text-base font-semibold text-ink">{incident.title}</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Field label="Assigned to">{props.queue}</Field>
          <Field label="Channel">{props.destination}</Field>
          <Field label="Service">{incident.affected_service}</Field>
          <Field label="Affected users">{incident.affected_users}</Field>
          <Field label="Departments">{incident.affected_departments.join(", ") || "—"}</Field>
          <Field label="Sites">{incident.affected_sites.join(", ") || "—"}</Field>
          <Field label="Workaround">{workaround}</Field>
          <Field label="Category">{a.category}</Field>
          <Field label="AI severity">{analysis.severity}</Field>
        </dl>
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Summary</h4>
          <p className="mt-1 text-sm text-slate-800">{props.summary}</p>
        </section>
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Description</h4>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{incident.description}</p>
          <p className="mt-1 text-sm text-slate-800">
            <span className="font-medium">Business impact:</span> {incident.business_impact}
          </p>
          {incident.diagnostic_evidence && (
            <p className="mt-1 text-sm text-slate-800">
              <span className="font-medium">Diagnostic evidence:</span> {incident.diagnostic_evidence}
            </p>
          )}
        </section>
        <section className="rounded-md border-l-4 border-orange-500 bg-orange-50 p-3">
          <h4 className="text-xs font-semibold text-orange-800">AI root cause and proof</h4>
          <p className="mt-1 text-sm font-semibold text-ink">{analysis.root_cause.label ?? a.root_cause}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-800">
            {a.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </section>
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Recommended actions (AI · require authorization)</h4>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-slate-800">
            {a.recommended_actions.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </section>
        {props.notes && (
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Review notes</h4>
            <p className="mt-1 text-sm text-slate-800">{props.notes}</p>
          </section>
        )}
      </div>
      <footer className="border-t border-line bg-canvas px-4 py-2 font-mono text-[11px] text-muted">
        {analysis.model_id} · request {analysis.request_id}
      </footer>
    </article>
  );
}
