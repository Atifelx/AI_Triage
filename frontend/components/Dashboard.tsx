"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError, submitFullTriage, submitTriage } from "@/lib/api";
import { loadDeck } from "@/lib/examples";
import { autoReview, type ReviewTicket } from "@/lib/integrations";
import { SAMPLE_INCIDENTS } from "@/lib/samples";
import type { Example, TriageRequest } from "@/lib/types";
import {
  EMPTY_FORM,
  formFieldFromApi,
  validateIncident,
  type FormErrors,
  type FormField,
  type IncidentFormValues,
} from "@/lib/validation";
import { ModeCard, useAnalysisMode } from "./AnalysisMode";
import { PageHeader, PageLayout } from "./PageLayout";
import { blockedReason, useHealthContext } from "./AppShell";
import type { Reference } from "./FullTriageResult";
import { IncidentForm } from "./IncidentForm";
import { RecentActivity, type ActivityItem } from "./RecentActivity";
import { ResultPanel, type AnalysisMode, type ResultState } from "./ResultPanel";
import { ReviewModal } from "./ReviewModal";
import { useReviewStore } from "./ReviewStore";

const HISTORY_LIMIT = 10;

function focusField(field: FormField) {
  document.getElementById(`f-${field}`)?.focus();
}

function exampleToForm(e: Example): IncidentFormValues {
  return {
    title: e.title,
    description: e.description,
    affected_service: e.affected_service,
    affected_users: String(e.affected_users),
    affected_departments: [...e.affected_departments],
    affected_sites: [...e.affected_sites],
    business_impact: e.business_impact,
    workaround: e.workaround_available === null ? "unknown" : e.workaround_available ? "yes" : "no",
    diagnostic_evidence: e.diagnostic_evidence,
    scope_check: e.scope_check,
    additional_context: e.additional_context,
  };
}

const sameForm = (a: IncidentFormValues, b: IncidentFormValues) => JSON.stringify(a) === JSON.stringify(b);

export function Dashboard() {
  const { backend, inference, refresh } = useHealthContext();

  const [values, setValues] = useState<IncidentFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [result, setResult] = useState<ResultState>({ kind: "idle" });
  const [history, setHistory] = useState<ActivityItem[]>([]);
  const [lastRequest, setLastRequest] = useState<TriageRequest | null>(null);
  // The incident that produced the full result on screen (kept for review routing).
  const [resultRequest, setResultRequest] = useState<TriageRequest | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Held-out example currently in the form, and dataset labels per analyzed request.
  const [loaded, setLoaded] = useState<{ example: Example; values: IncidentFormValues } | null>(null);
  const [references, setReferences] = useState<Record<string, Reference>>({});
  const [exampleNote, setExampleNote] = useState<string | null>(null);
  const { mode } = useAnalysisMode();
  const { addTicket } = useReviewStore();
  const inFlight = useRef(false); // guards against duplicate submissions
  const sampleIndex = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);

  const blocked = blockedReason(backend, inference);
  const submitting = result.kind === "loading";

  const run = useCallback(
    async (request: TriageRequest, runMode: AnalysisMode, reference: Reference | null) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setResult({ kind: "loading", mode: runMode });
      setNotice(null);
      try {
        if (runMode === "full") {
          const response = await submitFullTriage(request);
          if (reference) setReferences((r) => ({ ...r, [response.request_id]: reference }));
          setResult({ kind: "full", result: response });
          setResultRequest(request);
          // Every full analysis goes to Reviews for a human decision.
          const review = addTicket(autoReview(request, response, "Manual triage"));
          setNotice(`Added to Reviews as ${review.ticket_id} (pending review).`);
          setHistory((items) =>
            [{ type: "review" as const, ticket: review }, { type: "full" as const, result: response, request }, ...items].slice(0, HISTORY_LIMIT),
          );
        } else {
          const response = await submitTriage(request);
          setResult({ kind: "success", result: response });
          setHistory((items) => [{ type: "triage" as const, result: response }, ...items].slice(0, HISTORY_LIMIT));
        }
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError("unknown", "An unexpected error occurred.");
        if (apiError.kind === "validation") {
          const fieldErrors: FormErrors = {};
          for (const detail of apiError.fieldErrors) {
            const field = formFieldFromApi(detail.field);
            if (field && !fieldErrors[field]) fieldErrors[field] = detail.message;
          }
          setErrors(fieldErrors);
        }
        if (["network", "not_ready", "unavailable", "triage_unavailable"].includes(apiError.kind)) {
          refresh(); // re-sync header/banner with the backend's actual state
        }
        setResult({ kind: "error", error: apiError });
      } finally {
        inFlight.current = false;
        resultRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }
    },
    [refresh, addTicket],
  );

  const handleSubmit = () => {
    const validation = validateIncident(values);
    if (!validation.ok) {
      setErrors(validation.errors);
      const first = (Object.keys(validation.errors) as FormField[])[0];
      if (first) focusField(first);
      return;
    }
    setErrors({});
    setLastRequest(validation.request);
    void run(validation.request, mode, currentReference());
  };

  const handleChange = <K extends FormField>(field: K, value: IncidentFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  /** Dataset label applies only while the form still holds the loaded example unchanged. */
  const currentReference = (): Reference | null =>
    loaded && sameForm(loaded.values, values)
      ? {
          severity: loaded.example.reference.severity,
          category: loaded.example.reference.category,
          root_cause: loaded.example.reference.root_cause,
          source: `held-out example ${loaded.example.source_id}`,
        }
      : null;

  const handleLoadSample = async () => {
    const deck = await loadDeck();
    if (deck) {
      const { example, dealt } = deck.next();
      const form = exampleToForm(example);
      setValues(form);
      setLoaded({ example, values: form });
      setExampleNote(`Example ${dealt} of ${deck.size} · ${example.source_id} · held-out data the model never trained on`);
    } else {
      // Backend has no examples (older API): fall back to the bundled samples.
      setValues(SAMPLE_INCIDENTS[sampleIndex.current % SAMPLE_INCIDENTS.length]);
      sampleIndex.current += 1;
      setLoaded(null);
      setExampleNote(null);
    }
    setErrors({});
  };

  const handleClear = () => {
    setValues(EMPTY_FORM);
    setErrors({});
    setLoaded(null);
    setExampleNote(null);
  };

  const handleRetry = () => {
    if (lastRequest) void run(lastRequest, mode, currentReference());
  };

  const handleSelect = (item: ActivityItem) => {
    if (item.type === "full") {
      setResult({ kind: "full", result: item.result });
      setResultRequest(item.request);
    } else if (item.type === "triage") {
      setResult({ kind: "success", result: item.result });
    }
  };

  const handleSubmitted = (ticket: ReviewTicket) => {
    setReviewOpen(false);
    setHistory((items) =>
      items.some((i) => i.type === "review" && i.ticket.ticket_id === ticket.ticket_id)
        ? items.map((i) => (i.type === "review" && i.ticket.ticket_id === ticket.ticket_id ? { ...i, ticket } : i))
        : [{ type: "review" as const, ticket }, ...items].slice(0, HISTORY_LIMIT),
    );
    setNotice(`Review ticket ${ticket.ticket_id} sent to ${ticket.queue} (${ticket.destination_name}).`);
  };

  const selectedId = result.kind === "success" || result.kind === "full" ? result.result.request_id : null;

  return (
    <PageLayout
      header={
        <PageHeader
          title="Manual triage"
          description="Describe an incident and get a suggested severity, root cause, proof and next steps from the fine-tuned model. An engineer reviews every result."
        />
      }
      aside={
        <>
          <ModeCard inference={inference} disabled={submitting} />
          <RecentActivity items={history} selectedId={selectedId} onSelect={handleSelect} />
        </>
      }
    >
      <div className="space-y-2">
        {exampleNote && <p className="text-xs text-muted">{exampleNote}</p>}
        <IncidentForm
          values={values}
          errors={errors}
          submitting={submitting}
          blockedReason={blocked}
          onChange={handleChange}
          onSubmit={handleSubmit}
          onLoadSample={() => void handleLoadSample()}
          onClear={handleClear}
        />
      </div>

      <div ref={resultRef} className="scroll-mt-6 space-y-4">
        {notice && (
          <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-emerald-800 hover:text-emerald-950">
              ×
            </button>
          </div>
        )}
        <ResultPanel
          state={result}
          onRetry={handleRetry}
          canRetry={lastRequest !== null && !submitting}
          onSendForReview={resultRequest ? () => setReviewOpen(true) : undefined}
          reference={result.kind === "full" ? references[result.result.request_id] ?? null : null}
        />
      </div>
      {reviewOpen && result.kind === "full" && resultRequest && (
        <ReviewModal
          incident={resultRequest}
          result={result.result}
          source="Manual triage"
          onClose={() => setReviewOpen(false)}
          onSubmitted={handleSubmitted}
        />
      )}
    </PageLayout>
  );
}
