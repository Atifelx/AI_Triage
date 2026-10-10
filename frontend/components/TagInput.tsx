"use client";

import { useState, type KeyboardEvent } from "react";

interface TagInputProps {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  describedBy?: string;
  /** Singular noun for accessible labels, e.g. "department". */
  itemName: string;
}

/** Free-text list input: Enter or comma adds an entry; entries are removable chips. */
export function TagInput({
  id,
  values,
  onChange,
  placeholder,
  invalid = false,
  disabled = false,
  describedBy,
  itemName,
}: TagInputProps) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length) onChange([...values, ...parts]);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault(); // never submit the form from here
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div
      className={`flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-md border bg-white px-2 py-1.5 shadow-sm focus-within:ring-2 ${
        invalid
          ? "border-red-500 focus-within:ring-red-200"
          : "border-slate-300 focus-within:border-sky-600 focus-within:ring-sky-100"
      } ${disabled ? "bg-slate-50" : ""}`}
    >
      <ul className="contents" aria-label={`Selected ${itemName}s`}>
        {values.map((value, index) => (
          <li
            key={`${value}-${index}`}
            className="inline-flex items-center gap-1 rounded bg-slate-100 py-0.5 pl-2 pr-1 text-xs font-medium text-slate-800 ring-1 ring-slate-200"
          >
            {value}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
              aria-label={`Remove ${itemName} ${value}`}
              className="grid h-4 w-4 place-items-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-600"
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
      </ul>
      <input
        id={id}
        type="text"
        value={draft}
        disabled={disabled}
        placeholder={values.length === 0 ? placeholder : `Add ${itemName}`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          // Pasting "A, B, C" adds all entries at once.
          if (e.target.value.includes(",")) commit(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && commit(draft)}
        className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
      />
    </div>
  );
}
