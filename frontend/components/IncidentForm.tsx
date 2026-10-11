"use client";

import type { FormEvent } from "react";
import { LIMITS, type FormErrors, type FormField, type IncidentFormValues, type Workaround } from "@/lib/validation";
import { Field, describedBy, inputClass } from "./Field";
import { TagInput } from "./TagInput";

interface IncidentFormProps {
  values: IncidentFormValues;
  errors: FormErrors;
  submitting: boolean;
  /** When set, analysis is blocked and this explains why. */
  blockedReason: string | null;
  onChange: <K extends FormField>(field: K, value: IncidentFormValues[K]) => void;
  onSubmit: () => void;
  onLoadSample: () => void;
  onClear: () => void;
}

const WORKAROUND_OPTIONS: { value: Workaround; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unknown", label: "Unknown" },
];

export function IncidentForm({
  values,
  errors,
  submitting,
  blockedReason,
  onChange,
  onSubmit,
  onLoadSample,
  onClear,
}: IncidentFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submitting) onSubmit();
  };

  const text = (field: "title" | "affected_service", placeholder: string) => ({
    id: `f-${field}`,
    value: values[field],
    disabled: submitting,
    placeholder,
    "aria-invalid": Boolean(errors[field]) || undefined,
    "aria-describedby": describedBy(`f-${field}`, { error: errors[field] }),
    onChange: (e: { target: { value: string } }) => onChange(field, e.target.value),
    className: inputClass(Boolean(errors[field])),
  });

  const area = (
    field: "description" | "business_impact" | "diagnostic_evidence" | "scope_check" | "additional_context",
    placeholder: string,
    rows: number,
    hint?: string,
  ) => ({
    id: `f-${field}`,
    value: values[field] ?? "",
    disabled: submitting,
    placeholder,
    rows,
    "aria-invalid": Boolean(errors[field]) || undefined,
    "aria-describedby": describedBy(`f-${field}`, { hint, error: errors[field] }),
    onChange: (e: { target: { value: string } }) => onChange(field, e.target.value),
    className: `${inputClass(Boolean(errors[field]))} resize-y`,
  });

  const evidenceHint = "Logs, error codes or checks performed. Keep credentials and personal data out.";
  const listHint = "Press Enter or comma to add each entry.";
  const scopeHint = "What triage confirmed about the scope. Leave empty to derive it from users, departments, sites and workaround.";

  return (
    <section aria-labelledby="incident-form-heading" className="rounded-2xl border border-line bg-surface shadow-card">
      {/* Sticky action bar: Analyze stays visible while the form scrolls. */}
      <div className="sticky top-0 z-10 flex flex-col gap-3 rounded-t-2xl border-b border-line bg-surface/95 px-6 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="incident-form-heading" className="text-base font-semibold text-ink">
            New incident
          </h2>
          <p className="text-[13px] text-muted" aria-live="polite">
            {blockedReason ?? "Describe the incident, its scope and its business impact. A human reviews every result."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onLoadSample}
            disabled={submitting}
            className="rounded-lg border border-signal/30 bg-signal/5 px-3 py-1.5 text-sm font-medium text-signal-strong hover:bg-signal/10 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Load example
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={submitting}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-canvas disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Clear form
          </button>
          <button
            type="submit"
            form="incident-form"
            disabled={submitting || blockedReason !== null}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-signal px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-signal-strong disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            {submitting && (
              <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {submitting ? "Analyzing…" : "Analyze incident"}
          </button>
        </div>
      </div>

      <form id="incident-form" noValidate onSubmit={handleSubmit} aria-busy={submitting} className="grid grid-cols-1 gap-5 px-6 py-5 md:grid-cols-2">
        <Field
          id="f-title"
          label="Incident title"
          required
          error={errors.title}
          count={{ used: values.title.length, max: LIMITS.title.max }}
          className="md:col-span-2"
        >
          <input type="text" {...text("title", "e.g. Microsoft 365 sign-in failures")} />
        </Field>

        <Field
          id="f-description"
          label="Description"
          required
          error={errors.description}
          count={{ used: values.description.length, max: LIMITS.description.max }}
          className="md:col-span-2"
        >
          <textarea {...area("description", "What is happening, and since when?", 3)} />
        </Field>

        <Field id="f-affected_service" label="Affected service" required error={errors.affected_service}>
          <input type="text" {...text("affected_service", "e.g. Microsoft 365")} />
        </Field>

        <Field id="f-affected_users" label="Number of affected users" required error={errors.affected_users}>
          <input
            id="f-affected_users"
            type="number"
            inputMode="numeric"
            min={LIMITS.affected_users.min}
            max={LIMITS.affected_users.max}
            step={1}
            value={values.affected_users}
            disabled={submitting}
            placeholder="e.g. 45"
            aria-invalid={Boolean(errors.affected_users) || undefined}
            aria-describedby={describedBy("f-affected_users", { error: errors.affected_users })}
            onChange={(e) => onChange("affected_users", e.target.value)}
            className={inputClass(Boolean(errors.affected_users))}
          />
        </Field>

        <Field
          id="f-affected_departments"
          label="Affected departments"
          hint={listHint}
          error={errors.affected_departments}
        >
          <TagInput
            id="f-affected_departments"
            itemName="department"
            values={values.affected_departments}
            onChange={(v) => onChange("affected_departments", v)}
            placeholder="e.g. Finance"
            invalid={Boolean(errors.affected_departments)}
            disabled={submitting}
            describedBy={describedBy("f-affected_departments", { hint: listHint, error: errors.affected_departments })}
          />
        </Field>

        <Field id="f-affected_sites" label="Affected sites" hint={listHint} error={errors.affected_sites}>
          <TagInput
            id="f-affected_sites"
            itemName="site"
            values={values.affected_sites}
            onChange={(v) => onChange("affected_sites", v)}
            placeholder="e.g. Mumbai"
            invalid={Boolean(errors.affected_sites)}
            disabled={submitting}
            describedBy={describedBy("f-affected_sites", { hint: listHint, error: errors.affected_sites })}
          />
        </Field>

        <Field
          id="f-business_impact"
          label="Business impact"
          required
          error={errors.business_impact}
          count={{ used: values.business_impact.length, max: LIMITS.business_impact.max }}
          className="md:col-span-2"
        >
          <textarea {...area("business_impact", "What can the business not do right now?", 2)} />
        </Field>

        <fieldset className="md:col-span-2" aria-describedby={errors.workaround ? "f-workaround-error" : undefined}>
          <legend className="mb-1.5 text-sm font-medium text-slate-800">
            Workaround available<span className="ml-0.5 text-red-700" aria-hidden="true">*</span>
          </legend>
          <div className="inline-flex rounded-md border border-slate-300 bg-canvas p-0.5 shadow-sm">
            {WORKAROUND_OPTIONS.map((option) => {
              const checked = values.workaround === option.value;
              return (
                <label
                  key={option.value}
                  className={`cursor-pointer rounded px-4 py-1.5 text-[15px] font-normal has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-signal ${
                    checked ? "bg-slate-900 text-white shadow" : "text-slate-700 hover:bg-white"
                  } ${submitting ? "pointer-events-none opacity-60" : ""}`}
                >
                  <input
                    type="radio"
                    name="workaround"
                    value={option.value}
                    checked={checked}
                    disabled={submitting}
                    onChange={() => onChange("workaround", option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
          {errors.workaround && (
            <p id="f-workaround-error" className="mt-1 text-xs font-medium text-red-700">
              {errors.workaround}
            </p>
          )}
        </fieldset>

        <Field
          id="f-diagnostic_evidence"
          label="Diagnostic evidence"
          hint={evidenceHint}
          error={errors.diagnostic_evidence}
          count={{ used: values.diagnostic_evidence.length, max: LIMITS.diagnostic_evidence.max }}
          className="md:col-span-2"
        >
          <textarea {...area("diagnostic_evidence", "e.g. Authentication failures in sign-in logs", 3, evidenceHint)} />
        </Field>

        <Field
          id="f-scope_check"
          label="Scope check"
          hint={scopeHint}
          error={errors.scope_check}
          className="md:col-span-2"
        >
          <textarea {...area("scope_check", "e.g. The service desk confirmed multiple affected users in one department", 2, scopeHint)} />
        </Field>

        <Field
          id="f-additional_context"
          label="Additional context"
          error={errors.additional_context}
          className="md:col-span-2"
        >
          <textarea {...area("additional_context", "e.g. The issue has not been reproduced on an unrelated endpoint", 2)} />
        </Field>

      </form>
    </section>
  );
}
