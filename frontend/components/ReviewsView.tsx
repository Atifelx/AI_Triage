"use client";

import Link from "next/link";
import { REVIEW_STATUSES } from "@/lib/integrations";
import { PageHeader, PageLayout, RailCard } from "./PageLayout";
import { ReviewQueue } from "./ReviewQueue";
import { useReviewStore } from "./ReviewStore";

export function ReviewsView() {
  const { tickets } = useReviewStore();
  return (
    <PageLayout
      header={
        <PageHeader
          title="Reviews"
          description="Approve or reject AI triage, set the final severity, then route the incident to the owning team."
        />
      }
      aside={
        <>
          <RailCard title="Status">
            <dl className="divide-y divide-line">
              {REVIEW_STATUSES.map((s) => (
                <div key={s} className="flex items-center justify-between py-1.5">
                  <dt className="text-xs text-muted">{s}</dt>
                  <dd className="text-sm font-semibold tabular-nums text-ink">{tickets.filter((t) => t.status === s).length}</dd>
                </div>
              ))}
            </dl>
          </RailCard>
          <RailCard title="After approval">
            <ol className="list-decimal space-y-1.5 pl-4 text-xs text-slate-700">
              <li>The AI category picks the owning team.</li>
              <li>The final severity picks the systems: ServiceNow always; Jira for P1–P3; Slack and CRM for P1–P2; the Teams bridge for P1.</li>
              <li>Each system gets a message in its own format, with a delivery receipt.</li>
            </ol>
            <Link href="/integrations" className="mt-3 inline-block text-xs font-semibold text-signal hover:underline">
              Routing rules and connectors
            </Link>
          </RailCard>
        </>
      }
    >
      <ReviewQueue />
    </PageLayout>
  );
}
