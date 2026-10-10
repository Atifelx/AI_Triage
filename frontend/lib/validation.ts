import type { TriageRequest } from "./types";

// Limits mirror backend/app/schemas/incident.py. The backend remains the
// authority; its 422 field errors are shown the same way as these.
export const LIMITS = {
  title: { min: 3, max: 200 },
  description: { min: 10, max: 4000 },
  affected_service: { min: 2, max: 120 },
  business_impact: { min: 5, max: 2000 },
  diagnostic_evidence: { max: 4000 },
  affected_users: { min: 0, max: 1_000_000 },
  list: { maxItems: 20, itemMax: 80 },
} as const;

export type Workaround = "yes" | "no" | "unknown";

export interface IncidentFormValues {
  title: string;
  description: string;
  affected_service: string;
  affected_users: string; // raw input text
  affected_departments: string[];
  affected_sites: string[];
  business_impact: string;
  workaround: Workaround;
  diagnostic_evidence: string;
}

export type FormField = keyof IncidentFormValues;
export type FormErrors = Partial<Record<FormField, string>>;

export const EMPTY_FORM: IncidentFormValues = {
  title: "",
  description: "",
  affected_service: "",
  affected_users: "",
  affected_departments: [],
  affected_sites: [],
  business_impact: "",
  workaround: "unknown",
  diagnostic_evidence: "",
};

/** Maps backend field names (from 422 details) to form fields. */
export function formFieldFromApi(field: string): FormField | null {
  const root = field.split(".")[0];
  if (root === "workaround_available") return "workaround";
  return root in EMPTY_FORM ? (root as FormField) : null;
}

function checkText(
  value: string,
  label: string,
  { min, max }: { min?: number; max: number },
): string | undefined {
  const text = value.trim();
  if (min !== undefined && text.length === 0) return `${label} is required.`;
  if (min !== undefined && text.length < min) return `${label} must be at least ${min} characters.`;
  if (text.length > max) return `${label} must be at most ${max} characters.`;
  return undefined;
}

function checkList(items: string[], label: string): string | undefined {
  if (items.length > LIMITS.list.maxItems) return `Add at most ${LIMITS.list.maxItems} ${label}.`;
  const seen = new Set<string>();
  for (const item of items) {
    const text = item.trim();
    if (!text) return `${label} cannot contain empty entries.`;
    if (text.length > LIMITS.list.itemMax) return `Each entry must be at most ${LIMITS.list.itemMax} characters.`;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) return `"${text}" is listed more than once.`;
    seen.add(key);
  }
  return undefined;
}

function parseUsers(raw: string): { value?: number; error?: string } {
  const text = raw.trim();
  if (!text) return { error: "Number of affected users is required." };
  if (!/^\d+$/.test(text)) return { error: "Enter a whole number (0 or more)." };
  const value = Number(text);
  if (value > LIMITS.affected_users.max) {
    return { error: `Must be at most ${LIMITS.affected_users.max.toLocaleString("en-US")}.` };
  }
  return { value };
}

const WORKAROUND_VALUE: Record<Workaround, boolean | null> = { yes: true, no: false, unknown: null };

export function validateIncident(
  values: IncidentFormValues,
): { ok: true; request: TriageRequest } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  const set = (field: FormField, message: string | undefined) => {
    if (message) errors[field] = message;
  };

  set("title", checkText(values.title, "Incident title", LIMITS.title));
  set("description", checkText(values.description, "Description", LIMITS.description));
  set("affected_service", checkText(values.affected_service, "Affected service", LIMITS.affected_service));
  set("business_impact", checkText(values.business_impact, "Business impact", LIMITS.business_impact));
  set("diagnostic_evidence", checkText(values.diagnostic_evidence, "Diagnostic evidence", LIMITS.diagnostic_evidence));
  set("affected_departments", checkList(values.affected_departments, "departments"));
  set("affected_sites", checkList(values.affected_sites, "sites"));
  const users = parseUsers(values.affected_users);
  set("affected_users", users.error);

  if (Object.keys(errors).length > 0 || users.value === undefined) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    request: {
      title: values.title.trim(),
      description: values.description.trim(),
      affected_service: values.affected_service.trim(),
      affected_users: users.value,
      affected_departments: values.affected_departments.map((d) => d.trim()),
      affected_sites: values.affected_sites.map((s) => s.trim()),
      business_impact: values.business_impact.trim(),
      workaround_available: WORKAROUND_VALUE[values.workaround],
      diagnostic_evidence: values.diagnostic_evidence.trim(),
    },
  };
}
