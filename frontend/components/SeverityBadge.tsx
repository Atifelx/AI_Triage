import { SEVERITY_META } from "@/lib/severity";
import type { Severity } from "@/lib/types";

interface SeverityBadgeProps {
  severity: Severity;
  size?: "sm" | "lg";
}

export function SeverityBadge({ severity, size = "sm" }: SeverityBadgeProps) {
  const meta = SEVERITY_META[severity];
  if (size === "lg") {
    return (
      <div className={`inline-flex items-stretch overflow-hidden rounded-lg shadow-sm ${meta.badge}`}>
        <span className="px-4 py-2 font-mono text-4xl font-bold tracking-tight">{severity}</span>
        <span className="flex items-center border-l border-black/15 bg-black/10 px-4 text-lg font-semibold">
          {meta.label}
        </span>
      </div>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs font-bold ${meta.badge}`}
      title={`${severity} — ${meta.label}`}
    >
      {severity}
      <span className="sr-only"> — {meta.label}</span>
    </span>
  );
}
