"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CONNECTION_STATUS,
  DESTINATIONS,
  buildTicketPayload,
  defaultSummary,
  destinationById,
  validateDraft,
  type DestinationId,
  type DraftErrors,
  type ReviewDraft,
  type ReviewSource,
  type ReviewTicket,
} from "@/lib/integrations";
import { SEVERITY_META } from "@/lib/severity";
import type { FullTriageResponse, Severity, TriageRequest } from "@/lib/types";
import { useReviewStore } from "./ReviewStore";
import { TicketCard } from "./TicketCard";

interface ReviewModalProps {
  incident: TriageRequest;
  result: FullTriageResponse;
  source: ReviewSource;
  sourceRef?: string;
  onClose: () => void;
  onSubmitted: (ticket: ReviewTicket) => void;
}

const SEVERITIES: Severity[] = ["P1", "P2", "P3", "P4"];
const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-ink shadow-sm focus-visible:border-signal focus-visible:outline-2 focus-visible:outline-signal";

export function ReviewModal({ incident, result, source, sourceRef, onClose, onSubmitted }: ReviewModalProps) {
  const { addTicket, findByAnalysis, updateTicket } = useReviewStore();
  const existing = findByAnalysis(result.request_id);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<ReviewDraft>({
    destination: null,
    queue: "",
    priority: result.severity,
    summary: defaultSummary(incident, result),
    review_notes: "",
  });
  const [errors, setErrors] = useState<DraftErrors>({});
  const [preview, setPreview] = useState(false);

  // Focus the dialog, close on Escape, keep page scroll locked while open.
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const update = (patch: Partial<ReviewDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(patch)) delete next[key as keyof DraftErrors];
      return next;
    });
  };

  const chooseDestination = (id: DestinationId) => update({ destination: id, queue: destinationById(id).queues[0] });

  const confirm = () => {
    const found = validateDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0 || !draft.destination) return;
    const dest = destinationById(draft.destination);
    const routing = {
      destination: dest.id,
      destination_name: dest.name,
      queue: draft.queue,
      priority: draft.priority,
      summary: draft.summary.trim(),
      review_notes: draft.review_notes.trim(),
    };
    // The analysis already has a review ticket (created automatically): re-route it.
    if (existing) {
      updateTicket(existing.ticket_id, routing);
      onSubmitted({ ...existing, ...routing });
      return;
    }
    onSubmitted(addTicket({ ...routing, source, source_ref: sourceRef, incident, ai_analysis: result }));
  };

  const payload = buildTicketPayload(draft, incident, result, null);
  const queues = draft.destination ? destinationById(draft.destination).queues : [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-3xl rounded-xl bg-white shadow-2xl focus:outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              Route Incident for Human Review
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              Choose where this incident should be sent for human review. After approval it is routed to the owning
              team&apos;s systems.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-xl leading-none text-muted hover:bg-slate-100 hover:text-slate-800"
          >
            ×
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">
              Destination <span className="text-red-700">*</span>
            </legend>
            <div role="radiogroup" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {DESTINATIONS.map((d) => {
                const selected = draft.destination === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => chooseDestination(d.id)}
                    className={`flex gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${
                      selected ? "border-signal bg-sky-50 ring-1 ring-signal" : "border-line hover:border-slate-400"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg font-mono text-[11px] font-bold ${d.tile}`}
                    >
                      {d.monogram}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{d.name}</span>
                      <span className="block text-xs text-slate-600">{d.description}</span>
                      <span className="mt-1 block text-xs text-slate-700">
                        Destination: <span className="font-medium">{d.destination}</span>
                      </span>
                      <span className="mt-1 inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                        {CONNECTION_STATUS}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {errors.destination && <p className="mt-1 text-xs text-red-700">{errors.destination}</p>}
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="rv-queue" className="mb-1 block text-sm font-medium text-ink">
                Team or queue <span className="text-red-700">*</span>
              </label>
              <select
                id="rv-queue"
                value={draft.queue}
                onChange={(e) => update({ queue: e.target.value })}
                disabled={!draft.destination}
                aria-invalid={Boolean(errors.queue)}
                className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}
              >
                {!draft.destination && <option value="">Choose a destination first</option>}
                {queues.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
              {errors.queue && <p className="mt-1 text-xs text-red-700">{errors.queue}</p>}
            </div>
            <div>
              <label htmlFor="rv-priority" className="mb-1 block text-sm font-medium text-ink">
                Priority
              </label>
              <select
                id="rv-priority"
                value={draft.priority}
                onChange={(e) => update({ priority: e.target.value as Severity })}
                className={inputClass}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s} — {SEVERITY_META[s].label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">Prefilled from the AI severity ({result.severity}).</p>
            </div>
          </div>

          <div>
            <label htmlFor="rv-summary" className="mb-1 block text-sm font-medium text-ink">
              Incident summary <span className="text-red-700">*</span>
            </label>
            <textarea
              id="rv-summary"
              rows={3}
              value={draft.summary}
              onChange={(e) => update({ summary: e.target.value })}
              aria-invalid={Boolean(errors.summary)}
              className={inputClass}
            />
            {errors.summary && <p className="mt-1 text-xs text-red-700">{errors.summary}</p>}
          </div>

          <div>
            <label htmlFor="rv-notes" className="mb-1 block text-sm font-medium text-ink">
              Review notes <span className="text-xs font-normal text-muted">optional</span>
            </label>
            <textarea
              id="rv-notes"
              rows={2}
              value={draft.review_notes}
              onChange={(e) => update({ review_notes: e.target.value })}
              className={inputClass}
            />
          </div>

          {preview && (
            <section aria-label="Ticket preview" className="space-y-2">
              <p className="text-sm font-medium text-ink">Ticket preview</p>
              <TicketCard
                ticketId={existing?.ticket_id ?? "REV-(new)"}
                status="Pending Review"
                priority={draft.priority}
                destination={draft.destination ? destinationById(draft.destination).name : "—"}
                queue={draft.queue || "—"}
                summary={draft.summary}
                notes={draft.review_notes}
                incident={incident}
                analysis={result}
              />
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">Ticket payload (JSON)</summary>
                <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-200">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              </details>
            </section>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-canvas"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            className="rounded-md border border-sky-700 bg-white px-4 py-2 text-sm font-semibold text-signal-strong hover:bg-sky-50"
          >
            {preview ? "Hide Preview" : "Preview Ticket"}
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded-full bg-signal px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-signal-strong"
          >
            Submit for Review
          </button>
        </div>
      </div>
    </div>
  );
}
