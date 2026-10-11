import Link from "next/link";
import { formatTime } from "@/lib/format";
import type { ReviewTicket } from "@/lib/integrations";
import type { FullTriageResponse, TriageRequest, TriageResponse } from "@/lib/types";
import { SeverityBadge } from "./SeverityBadge";

export type ActivityItem =
  | { type: "triage"; result: TriageResponse }
  | { type: "full"; result: FullTriageResponse; request: TriageRequest }
  | { type: "review"; ticket: ReviewTicket };

export const activityKey = (item: ActivityItem) =>
  item.type === "review" ? `review-${item.ticket.ticket_id}` : item.result.request_id;

interface RecentActivityProps {
  items: ActivityItem[];
  selectedId: string | null;
  onSelect: (item: ActivityItem) => void;
}

function MockTag({ children = "MOCK" }: { children?: string }) {
  return <span className="rounded bg-amber-100 px-1 font-mono text-[10px] font-bold text-amber-900">{children}</span>;
}

export function RecentActivity({ items, selectedId, onSelect }: RecentActivityProps) {
  return (
    <section aria-labelledby="recent-heading" className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="border-b border-line px-4 py-3">
        <h2 id="recent-heading" className="text-sm font-semibold text-ink">
          Recent activity
        </h2>
        <span className="text-xs text-muted">This browser session</span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-muted">No incidents analyzed in this session yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => {
            const key = activityKey(item);
            if (item.type === "review") {
              const t = item.ticket;
              return (
                <li key={key} className="flex items-center gap-2.5 px-4 py-2.5">
                  <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded bg-sky-100 text-xs text-signal-strong">
                    ↗
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      Review ticket {t.ticket_id} → {t.queue}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      {t.destination_name} ·
                      <Link href="/reviews" className="font-semibold text-signal hover:underline">
                        Open review queue
                      </Link>
                    </span>
                  </span>
                  <time dateTime={t.created_at} className="shrink-0 text-xs tabular-nums text-muted">
                    {formatTime(t.created_at)}
                  </time>
                </li>
              );
            }
            const result = item.result;
            const severity = item.result.severity;
            const selected = key === selectedId;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  aria-current={selected ? "true" : undefined}
                  className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal ${
                    selected ? "bg-sky-50/60" : ""
                  }`}
                >
                  <SeverityBadge severity={severity} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{result.incident_title}</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      {result.provider}
                      {item.type === "full" && <span className="text-slate-400">· full triage</span>}
                      {result.is_mock && <MockTag />}
                    </span>
                  </span>
                  <time dateTime={result.created_at} className="shrink-0 text-xs tabular-nums text-muted">
                    {formatTime(result.created_at)}
                  </time>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
