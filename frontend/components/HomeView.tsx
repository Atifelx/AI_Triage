"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { getEvaluation, getTicketSession, getTriageEvaluation } from "@/lib/api";
import type { EvaluationResponse, TicketSession, TriageEvaluationResponse } from "@/lib/types";
import { useAnalysisMode } from "./AnalysisMode";
import { useHealthContext } from "./AppShell";
import { useReviewStore } from "./ReviewStore";

const pct = (correct: number, total: number) => (total ? `${Math.round((correct / total) * 100)}%` : "—");

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function ActionCard({
  href,
  tile,
  icon,
  title,
  text,
  stat,
}: {
  href: string;
  tile: string;
  icon: string;
  title: string;
  text: string;
  stat: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col justify-between gap-6 rounded-2xl bg-surface p-6 shadow-card ring-1 ring-black/[0.04] transition-shadow hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      <div>
        <span className={`grid h-11 w-11 place-items-center rounded-xl text-white ${tile}`}>
          <Glyph d={icon} />
        </span>
        <h2 className="mt-4 text-[19px] font-semibold tracking-tight text-ink">{title}</h2>
        <p className="mt-1 text-[15px] leading-6 text-muted">{text}</p>
      </div>
      <div className="flex items-center justify-between border-t border-line pt-4 text-[13px]">
        <span className="text-muted">{stat}</span>
        <span aria-hidden="true" className="text-signal transition-transform group-hover:translate-x-0.5">
          ›
        </span>
      </div>
    </Link>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <p className="title-large text-[28px] font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-[13px] font-medium text-ink">{label}</p>
      <p className="text-[12px] text-muted">{note}</p>
    </div>
  );
}

const STEPS = [
  ["Describe", "An incident from the form, an example, or the queue."],
  ["Analyze", "Two LoRA adapters on one Gemma 3 base model return severity, root cause, proof and actions."],
  ["Review", "An engineer approves or rejects and sets the final severity."],
  ["Route", "The owning team's ServiceNow, Jira, Slack, Teams and CRM receive the incident."],
];

/** Overview: where the day starts. Every number here comes from the API. */
export function HomeView() {
  const { inference } = useHealthContext();
  const { fullAvailable } = useAnalysisMode();
  const { tickets } = useReviewStore();
  const [session, setSession] = useState<TicketSession | null>(null);
  const [offline, setOffline] = useState<TriageEvaluationResponse | null>(null);
  const [live, setLive] = useState<EvaluationResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const quiet = () => undefined; // overview numbers are optional; pages report their own errors
    getTicketSession(controller.signal).then(setSession).catch(quiet);
    getTriageEvaluation(controller.signal).then(setOffline).catch(quiet);
    getEvaluation(controller.signal).then(setLive).catch(quiet);
    return () => controller.abort();
  }, []);

  const pending = tickets.filter((t) => t.status === "Pending Review" || t.status === "In Review").length;
  const toRoute = tickets.filter((t) => t.status === "Approved").length;
  const ft = offline?.fine_tuned;

  return (
    <div className="space-y-10">
      <header className="pt-2">
        <p className="text-[15px] font-medium text-signal">TriageLens</p>
        <h1 className="title-large mt-1 max-w-3xl text-[40px] font-semibold leading-[1.1] text-ink sm:text-[48px]">
          Every incident triaged with proof, approved by an engineer.
        </h1>
        <p className="mt-3 max-w-2xl text-[17px] leading-7 text-muted">
          A fine-tuned Gemma 3 model suggests severity, root cause and next steps for your service desk. People
          review every ticket before it reaches a team.
        </p>
      </header>

      <section aria-label="Start" className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <ActionCard
          href="/triage"
          tile="bg-signal"
          icon="M4 6h16M4 12h10M4 18h6M17 15a3 3 0 1 0 0 .01M19.5 17.5 22 20"
          title="Triage an incident"
          text="Describe an incident, or load one of 50 held-out examples."
          stat={fullAvailable ? "Full triage ready" : inference?.ready ? "Severity only" : "Model not ready"}
        />
        <ActionCard
          href="/queue"
          tile="bg-indigo-500"
          icon="M4 5h16v4H4zM4 11h16v4H4zM4 17h9"
          title="Work the ticket queue"
          text={`${session?.total ?? 120} held-out tickets, one at a time, checked against their labels.`}
          stat={session ? `${session.issued} of ${session.total} issued · ${session.analyzed} analyzed` : "Queue"}
        />
        <ActionCard
          href="/reviews"
          tile="bg-emerald-600"
          icon="M7 4h10v17l-5-3-5 3zM9.5 10l2 2 3.5-3.5"
          title="Review and route"
          text="Approve AI triage, set the final severity, route it to the owning team."
          stat={
            tickets.length === 0
              ? "No tickets waiting"
              : `${pending} waiting for review${toRoute ? ` · ${toRoute} ready to route` : ""}`
          }
        />
      </section>

      <section aria-labelledby="model-heading" className="rounded-2xl bg-surface p-6 shadow-card ring-1 ring-black/[0.04]">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 id="model-heading" className="text-[19px] font-semibold tracking-tight text-ink">
            The model
          </h2>
          <Link href="/evaluation" className="text-[13px] font-medium text-signal hover:underline">
            Evaluation
          </Link>
        </div>
        <p className="mt-1 text-[15px] text-muted">
          Gemma 3 270M with two LoRA adapters. One answers category, root cause, proof and actions; the other answers
          severity.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
          {ft?.category && (
            <Metric label="Category" value={pct(ft.category.correct, ft.category.total)} note={`triage adapter · held-out n=${ft.category.total}`} />
          )}
          {ft?.root_cause && (
            <Metric label="Root cause" value={pct(ft.root_cause.correct, ft.root_cause.total)} note={`triage adapter · held-out n=${ft.root_cause.total}`} />
          )}
          {live && live.analyzed > 0 ? (
            <Metric label="Severity" value={pct(live.correct, live.analyzed)} note={`severity adapter · this session n=${live.analyzed}`} />
          ) : (
            <Metric label="Severity" value="—" note="Analyze queue tickets to measure it here" />
          )}
          <Metric
            label="Status"
            value={inference?.ready ? "Ready" : inference ? "Loading" : "Offline"}
            note={inference?.device ? `running on ${inference.device}` : "backend"}
          />
        </div>
        {!ft && <p className="mt-4 text-[13px] text-muted">Offline metrics are unavailable from the API right now.</p>}
        <p className="mt-6 text-[12px] text-muted">Measured on synthetic, template-written tickets. Real-ticket accuracy has not been measured yet.</p>
      </section>

      <section aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-[19px] font-semibold tracking-tight text-ink">
          How it works
        </h2>
        <ol className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="rounded-2xl bg-surface p-5 shadow-card ring-1 ring-black/[0.04]">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-signal/10 text-[13px] font-semibold text-signal-strong">
                {i + 1}
              </span>
              <p className="mt-3 text-[15px] font-semibold text-ink">{title}</p>
              <p className="mt-1 text-[13px] leading-5 text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
