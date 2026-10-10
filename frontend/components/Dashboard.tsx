"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError, submitTriage } from "@/lib/api";
import { SAMPLE_INCIDENTS } from "@/lib/samples";
import type { TriageRequest, TriageResponse } from "@/lib/types";
import {
  EMPTY_FORM,
  formFieldFromApi,
  validateIncident,
  type FormErrors,
  type FormField,
  type IncidentFormValues,
} from "@/lib/validation";
import { blockedReason, useHealthContext } from "./AppShell";
import { IncidentForm } from "./IncidentForm";
import { RecentActivity } from "./RecentActivity";
import { ResultPanel, type ResultState } from "./ResultPanel";

const HISTORY_LIMIT = 10;

function focusField(field: FormField) {
  document.getElementById(`f-${field}`)?.focus();
}

export function Dashboard() {
  const { backend, inference, refresh } = useHealthContext();

  const [values, setValues] = useState<IncidentFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [result, setResult] = useState<ResultState>({ kind: "idle" });
  const [history, setHistory] = useState<TriageResponse[]>([]);
  const [lastRequest, setLastRequest] = useState<TriageRequest | null>(null);
  const inFlight = useRef(false); // guards against duplicate submissions
  const sampleIndex = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);

  const blocked = blockedReason(backend, inference);
  const submitting = result.kind === "loading";

  const run = useCallback(
    async (request: TriageRequest) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setResult({ kind: "loading" });
      try {
        const response = await submitTriage(request);
        setResult({ kind: "success", result: response });
        setHistory((items) => [response, ...items].slice(0, HISTORY_LIMIT));
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
        if (apiError.kind === "network" || apiError.kind === "not_ready" || apiError.kind === "unavailable") {
          refresh(); // re-sync header/banner with the backend's actual state
        }
        setResult({ kind: "error", error: apiError });
      } finally {
        inFlight.current = false;
        resultRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      }
    },
    [refresh],
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
    void run(validation.request);
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

  const handleLoadSample = () => {
    setValues(SAMPLE_INCIDENTS[sampleIndex.current % SAMPLE_INCIDENTS.length]);
    sampleIndex.current += 1;
    setErrors({});
  };

  const handleClear = () => {
    setValues(EMPTY_FORM);
    setErrors({});
  };

  const handleRetry = () => {
    if (lastRequest) void run(lastRequest);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <IncidentForm
          values={values}
          errors={errors}
          submitting={submitting}
          blockedReason={blocked}
          onChange={handleChange}
          onSubmit={handleSubmit}
          onLoadSample={handleLoadSample}
          onClear={handleClear}
        />
      </div>
      <div ref={resultRef} className="space-y-6 lg:col-span-5">
        <ResultPanel state={result} onRetry={handleRetry} canRetry={lastRequest !== null && !submitting} />
        <RecentActivity
          items={history}
          selectedId={result.kind === "success" ? result.result.request_id : null}
          onSelect={(item) => setResult({ kind: "success", result: item })}
        />
      </div>
    </div>
  );
}
