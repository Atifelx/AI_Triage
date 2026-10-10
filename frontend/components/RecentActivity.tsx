import { formatTime } from "@/lib/format";
import type { TriageResponse } from "@/lib/types";
import { SeverityBadge } from "./SeverityBadge";

interface RecentActivityProps {
  items: TriageResponse[];
  selectedId: string | null;
  onSelect: (item: TriageResponse) => void;
}

export function RecentActivity({ items, selectedId, onSelect }: RecentActivityProps) {
  return (
    <section aria-labelledby="recent-heading" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-baseline justify-between border-b border-slate-200 px-5 py-4">
        <h2 id="recent-heading" className="text-base font-semibold text-slate-900">
          Recent activity
        </h2>
        <span className="text-xs text-slate-500">This browser session</span>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-slate-500">No incidents analyzed in this session yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => {
            const selected = item.request_id === selectedId;
            return (
              <li key={item.request_id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  aria-current={selected ? "true" : undefined}
                  className={`flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600 ${
                    selected ? "bg-sky-50/60" : ""
                  }`}
                >
                  <SeverityBadge severity={item.severity} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{item.incident_title}</span>
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      {item.provider}
                      {item.is_mock && (
                        <span className="rounded bg-amber-100 px-1 font-mono text-[10px] font-bold text-amber-900">
                          MOCK
                        </span>
                      )}
                    </span>
                  </span>
                  <time dateTime={item.created_at} className="shrink-0 text-xs tabular-nums text-slate-500">
                    {formatTime(item.created_at)}
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
