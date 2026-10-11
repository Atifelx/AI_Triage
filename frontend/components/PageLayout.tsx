import type { ReactNode } from "react";

/** Page title row: title + one-line description on the left, page actions on the right. */
export function PageHeader({ title, description, actions }: { title: string; description: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="title-large text-[32px] font-semibold leading-tight text-ink">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-[15px] leading-6 text-muted">{description}</p>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

/**
 * 80 / 20 page body: the work flows down the main column; supporting context sits in a
 * sticky right rail. Below xl the rail stacks after the main column.
 */
export function PageLayout({ header, children, aside }: { header: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="space-y-6">
      {header}
      <div className={aside ? "grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,4fr)_minmax(260px,1fr)]" : ""}>
        <div className="min-w-0 space-y-6">{children}</div>
        {aside && (
          <aside aria-label="Page context" className="min-w-0 space-y-4 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:self-start xl:overflow-y-auto">
            {aside}
          </aside>
        )}
      </div>
    </div>
  );
}

/** Compact card for the right rail. */
export function RailCard({ title, children }: { title: string; children: ReactNode }) {
  const id = `rail-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <h2 id={id} className="mb-2 text-[15px] font-semibold text-ink">
        {title}
      </h2>
      <div className="text-sm text-slate-700">{children}</div>
    </section>
  );
}
