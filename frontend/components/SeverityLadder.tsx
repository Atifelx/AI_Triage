import { SEVERITY_META } from "@/lib/severity";
import type { Severity } from "@/lib/types";

// One-line policies from the training instruction (backend gemma_prompt.SEVERITY_INSTRUCTION).
const POLICY: Record<Severity, string> = {
  P1: "Critical service down across departments and sites, no safe workaround",
  P2: "Multiple users in one department blocked; others operational",
  P3: "One user or endpoint affected; others work normally",
  P4: "No material service interruption; low impact",
};

const RUNGS: Severity[] = ["P1", "P2", "P3", "P4"];

interface SeverityLadderProps {
  predicted: Severity;
  /** The triage adapter's own severity, when it differs from `predicted`. */
  check?: Severity | null;
  /** Dataset label, only for held-out examples and queue tickets (after inference). */
  reference?: Severity | null;
}

function Marker({ children, tone }: { children: string; tone: "ink" | "outline" | "reference" }) {
  const cls = {
    ink: "bg-ink text-white",
    outline: "border border-slate-400 bg-white text-slate-700",
    reference: "border border-emerald-600 bg-emerald-50 text-emerald-800",
  }[tone];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>;
}

/** P1–P4 as a scale: the severity in use is lit; the triage adapter's answer and the reference sit on their own rungs. */
export function SeverityLadder({ predicted, check, reference }: SeverityLadderProps) {
  return (
    <ol aria-label="Severity scale" className="space-y-1">
      {RUNGS.map((rung) => {
        const meta = SEVERITY_META[rung];
        const lit = rung === predicted;
        return (
          <li
            key={rung}
            aria-current={lit ? "true" : undefined}
            className={`flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors ${lit ? `${meta.badge} shadow-sm` : "text-muted"}`}
          >
            <span className={`w-7 font-mono text-sm font-bold ${lit ? "" : "text-slate-400"}`}>{rung}</span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm ${lit ? "font-semibold" : "font-medium text-slate-600"}`}>{meta.label}</span>
              <span className={`block text-[11px] leading-4 ${lit ? "opacity-90" : "text-slate-400"}`}>{POLICY[rung]}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {check === rung && <Marker tone="ink">Triage adapter</Marker>}
              {reference === rung && <Marker tone="reference">Reference</Marker>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
