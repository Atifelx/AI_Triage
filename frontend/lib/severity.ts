import type { Severity } from "./types";

interface SeverityMeta {
  label: string;
  /** Solid badge: colour pairs chosen for >= 4.5:1 contrast. */
  badge: string;
  /** Tinted surface + border for larger result cards. */
  surface: string;
  dot: string;
}

export const SEVERITY_META: Record<Severity, SeverityMeta> = {
  P1: {
    label: "Critical",
    badge: "bg-red-700 text-white",
    surface: "bg-red-50 border-red-200 text-red-900",
    dot: "bg-red-600",
  },
  P2: {
    label: "High",
    badge: "bg-orange-700 text-white",
    surface: "bg-orange-50 border-orange-200 text-orange-900",
    dot: "bg-orange-600",
  },
  P3: {
    label: "Medium",
    badge: "bg-amber-300 text-amber-950",
    surface: "bg-amber-50 border-amber-200 text-amber-900",
    dot: "bg-amber-400",
  },
  P4: {
    label: "Low",
    badge: "bg-sky-700 text-white",
    surface: "bg-sky-50 border-sky-200 text-sky-900",
    dot: "bg-sky-600",
  },
};

export function severityText(severity: Severity): string {
  return `${severity} — ${SEVERITY_META[severity].label}`;
}
