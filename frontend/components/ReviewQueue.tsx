"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { formatTimestamp } from "@/lib/format";
import type { ReviewStatus, ReviewTicket } from "@/lib/integrations";
import { SEVERITY_META } from "@/lib/severity";
import type { Severity } from "@/lib/types";
import { DispatchPanel } from "./DispatchPanel";
import { useReviewStore } from "./ReviewStore";
import { SeverityBadge } from "./SeverityBadge";
import { TicketCard } from "./TicketCard";

const STATUS_STYLE: Record<ReviewStatus, string> = {
  "Pending Review": "bg-slate-100 text-slate-800",
  "In Review": "bg-sky-100 text-sky-900",
  Approved: "bg-emerald-100 text-emerald-900",
  Rejected: "bg-red-100 text-red-900",
  "With team": "bg-violet-100 text-violet-900",
};

const SEVERITIES: Severity[] = ["P1", "P2", "P3", "P4"];
const input =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-ink shadow-sm focus-visible:border-signal focus-visible:outline-2 focus-visible:outline-signal";

function StatusBadge({ status }: { status: ReviewStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{status}</span>;
}

function DecisionForm({ ticket }: { ticket: ReviewTicket }) {
  const { updateTicket } = useReviewStore();
  const [reviewer, setReviewer] = useState("");
  const [severity, setSeverity] = useState<Severity>(ticket.priority);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = (status: "Approved" | "Rejected") => {
    if (reviewer.trim().length < 2) {
      setError("Enter the reviewer's name.");
      return;
    }
    if (status === "Rejected" && notes.trim().length < 3) {
      setError("Add a note explaining the rejection.");
      return;
    }
    updateTicket(ticket.ticket_id, {
      status,
      decision: { reviewer: reviewer.trim(), approved_severity: severity, notes: notes.trim(), decided_at: new Date().toISOString() },
    });
  };

  return (
    <section aria-label="Review decision" className="space-y-3 rounded-lg border border-line bg-white p-4">
      <h4 className="text-sm font-semibold text-ink">Review decision</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`rv-name-${ticket.ticket_id}`} className="mb-1 block text-xs font-medium text-slate-700">
            Reviewer
          </label>
          <input id={`rv-name-${ticket.ticket_id}`} value={reviewer} onChange={(e) => setReviewer(e.target.value)} className={input} placeholder="Your name" />
        </div>
        <div>
          <label htmlFor={`rv-sev-${ticket.ticket_id}`} className="mb-1 block text-xs font-medium text-slate-700">
            Final severity
          </label>
          <select id={`rv-sev-${ticket.ticket_id}`} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className={input}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s} — {SEVERITY_META[s].label}
                {s === ticket.ai_analysis.severity ? " (AI)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`rv-dnotes-${ticket.ticket_id}`} className="mb-1 block text-xs font-medium text-slate-700">
          Decision notes
        </label>
        <textarea id={`rv-dnotes-${ticket.ticket_id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
      </div>
      {error && <p role="alert" className="text-xs font-medium text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => decide("Approved")} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
          Approve
        </button>
        <button type="button" onClick={() => decide("Rejected")} className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50">
          Reject
        </button>
      </div>
    </section>
  );
}

function Workflow({ ticket }: { ticket: ReviewTicket }) {
  const { setStatus, updateTicket } = useReviewStore();
  const d = ticket.decision;
  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Workflow">
        {(["Pending Review", "In Review", "Approved", "With team"] as ReviewStatus[]).map((step, i, all) => {
          const order = ["Pending Review", "In Review", "Approved", "With team"];
          const reached = ticket.status !== "Rejected" && order.indexOf(ticket.status) >= i;
          return (
            <li key={step} className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 font-semibold ${reached ? "bg-signal text-white" : "bg-slate-100 text-muted"}`}>{step}</span>
              {i < all.length - 1 && <span aria-hidden="true" className="text-slate-400">→</span>}
            </li>
          );
        })}
      </ol>

      {d && (
        <p className="text-sm text-slate-700">
          <StatusBadge status={ticket.status === "Rejected" ? "Rejected" : "Approved"} /> by <span className="font-semibold">{d.reviewer}</span>{" "}
          · final severity <SeverityBadge severity={d.approved_severity} />
          {d.approved_severity !== ticket.ai_analysis.severity && (
            <span className="text-xs text-muted"> (AI suggested {ticket.ai_analysis.severity})</span>
          )}
          {d.notes && <span className="block text-xs text-slate-600">“{d.notes}”</span>}
        </p>
      )}

      {ticket.status === "Pending Review" && (
        <button type="button" onClick={() => setStatus(ticket.ticket_id, "In Review")} className="rounded-full bg-signal px-4 py-2 text-sm font-semibold text-white hover:bg-signal-strong">
          Start review
        </button>
      )}
      {ticket.status === "In Review" && <DecisionForm ticket={ticket} />}
      {(ticket.status === "Approved" || ticket.status === "With team") && (
        <DispatchPanel ticket={ticket} onDispatched={(result) => updateTicket(ticket.ticket_id, { status: "With team", dispatch: result })} />
      )}
    </div>
  );
}

export function ReviewQueue() {
  const { tickets } = useReviewStore();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section aria-labelledby="review-queue-heading" className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="border-b border-line px-6 py-4">
        <h2 id="review-queue-heading" className="text-base font-semibold text-ink">
          Review queue
        </h2>
        <p className="text-xs text-muted">Open a ticket to start the review, decide, and route it.</p>
      </div>
      {tickets.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-muted">
          No review tickets yet. Run a <Link href="/triage" className="font-semibold text-signal hover:underline">full triage</Link> and choose Send for Review.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-muted">
              <tr>
                {["Ticket", "Incident", "Severity", "Category", "Root cause", "Destination", "Queue / team", "Status", "Created", ""].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tickets.map((t) => {
                const open = openId === t.ticket_id;
                return (
                  <Fragment key={t.ticket_id}>
                    <tr className={open ? "bg-sky-50/50" : undefined}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{t.ticket_id}</td>
                      <td className="max-w-56 px-3 py-2" title={t.incident.title}>
                        <span className="block truncate">{t.incident.title}</span>
                        <span className="block truncate text-[11px] text-muted">
                          {t.source}
                          {t.source_ref ? ` · ${t.source_ref}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2"><SeverityBadge severity={t.decision?.approved_severity ?? t.priority} /></td>
                      <td className="px-3 py-2 font-mono text-xs">{t.ai_analysis.analysis.category}</td>
                      <td className="max-w-44 truncate px-3 py-2 text-xs" title={t.ai_analysis.analysis.root_cause}>
                        {t.ai_analysis.root_cause.label ?? t.ai_analysis.analysis.root_cause}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{t.destination_name}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{t.queue}</td>
                      <td className="whitespace-nowrap px-3 py-2"><StatusBadge status={t.status} /></td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
                        <time dateTime={t.created_at}>{formatTimestamp(t.created_at)}</time>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setOpenId(open ? null : t.ticket_id)}
                          aria-expanded={open}
                          className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-canvas"
                        >
                          {open ? "Close" : "Open"}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={10} className="p-0">
                          <div className="grid grid-cols-1 gap-6 bg-canvas px-5 py-5 xl:grid-cols-12">
                            <div className="xl:col-span-5">
                              <TicketCard
                                ticketId={t.ticket_id}
                                status={t.status}
                                priority={t.decision?.approved_severity ?? t.priority}
                                destination={t.destination_name}
                                queue={t.queue}
                                summary={t.summary}
                                notes={t.review_notes}
                                incident={t.incident}
                                analysis={t.ai_analysis}
                                createdAt={t.created_at}
                              />
                            </div>
                            <div className="xl:col-span-7">
                              <Workflow ticket={t} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
