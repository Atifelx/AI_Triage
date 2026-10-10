export type StatusTone = "success" | "danger" | "info" | "mock" | "neutral";

const TONES: Record<StatusTone, { pill: string; dot: string }> = {
  success: { pill: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200", dot: "bg-emerald-400" },
  danger: { pill: "border-red-400/50 bg-red-500/15 text-red-200", dot: "bg-red-400" },
  info: { pill: "border-sky-400/40 bg-sky-400/10 text-sky-200", dot: "bg-sky-400" },
  mock: { pill: "border-amber-300/60 bg-amber-300/15 text-amber-100", dot: "bg-amber-300" },
  neutral: { pill: "border-slate-500/50 bg-slate-500/10 text-slate-300", dot: "bg-slate-400" },
};

interface StatusPillProps {
  /** Short category shown before the value, e.g. "API". */
  label: string;
  value: string;
  tone: StatusTone;
  pulse?: boolean;
  title?: string;
}

export function StatusPill({ label, value, tone, pulse = false, title }: StatusPillProps) {
  const t = TONES[tone];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap ${t.pill}`}
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${t.dot}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${t.dot}`} />
      </span>
      <span className="text-slate-400">{label}</span>
      <span>{value}</span>
    </span>
  );
}
