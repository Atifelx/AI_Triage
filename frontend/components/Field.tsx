import type { ReactNode } from "react";

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  /** Shown as "used / max" when provided. */
  count?: { used: number; max: number };
  children: ReactNode;
  className?: string;
}

/** Ids used by the control for aria-describedby. */
export function describedBy(id: string, { hint, error }: { hint?: string; error?: string }): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

export function Field({ id, label, required, hint, error, count, children, className = "" }: FieldProps) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[15px] font-normal text-ink">
          {label}
          {required ? (
            <span className="ml-0.5 text-red-700" aria-hidden="true">
              *
            </span>
          ) : (
            <span className="ml-1.5 text-xs font-normal text-muted">optional</span>
          )}
        </label>
        {count && (
          <span
            className={`text-xs tabular-nums ${count.used > count.max ? "font-semibold text-red-700" : "text-muted"}`}
          >
            {count.used}/{count.max}
          </span>
        )}
      </div>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-[13px] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 flex items-start gap-1 text-[13px] font-medium text-red-700">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass = (invalid: boolean) =>
  `block w-full rounded-lg border bg-white px-3 py-2.5 text-[16px] leading-6 font-normal text-ink shadow-sm placeholder:text-slate-400 ` +
  `focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-canvas ` +
  (invalid
    ? "border-red-500 focus:border-red-500 focus:ring-red-200"
    : "border-slate-300 focus:border-signal focus:ring-sky-100");
