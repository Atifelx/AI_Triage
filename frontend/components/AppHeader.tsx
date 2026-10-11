"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { BackendStatus } from "@/hooks/useHealth";
import type { InferenceHealth } from "@/lib/types";
import { Logo } from "./Logo";
import { useReviewStore } from "./ReviewStore";
import type { StatusTone } from "./StatusPill";

interface AppHeaderProps {
  backend: BackendStatus;
  inference: InferenceHealth | null;
}

function apiStatus(backend: BackendStatus): { value: string; tone: StatusTone; pulse: boolean } {
  switch (backend) {
    case "online":
      return { value: "Online", tone: "success", pulse: false };
    case "offline":
      return { value: "Offline", tone: "danger", pulse: false };
    default:
      return { value: "Checking…", tone: "neutral", pulse: true };
  }
}

/** Model readiness is derived only from the provider status, never from API liveness. */
export function modelStatus(inference: InferenceHealth | null): {
  value: string;
  tone: StatusTone;
  pulse: boolean;
} {
  if (!inference) return { value: "Unknown", tone: "neutral", pulse: false };
  if (inference.is_mock) return { value: "Mock mode · no model", tone: "mock", pulse: false };
  switch (inference.state) {
    case "ready":
      return { value: "Ready", tone: "success", pulse: false };
    case "loading":
      return { value: "Loading…", tone: "info", pulse: true };
    case "unavailable":
      return { value: "Unavailable", tone: "danger", pulse: false };
    default:
      return { value: "Not loaded", tone: "neutral", pulse: false };
  }
}

const DOT: Record<StatusTone, string> = {
  success: "bg-emerald-500",
  danger: "bg-red-500",
  info: "bg-sky-500",
  neutral: "bg-slate-400",
  mock: "bg-amber-500",
};

/* Icons: 20px, 1.6 stroke, drawn for this app (no icon dependency). */
const ICONS: Record<string, ReactNode> = {
  home: <path d="M3.5 9.5 10 4l6.5 5.5M5.5 8.5V16h3.5v-4h2v4h3.5V8.5" />,
  triage: <path d="M4 5h12M4 10h8M4 15h5M15 12.5a2.5 2.5 0 1 0 0 .01M17 14.5l2 2" />,
  queue: <path d="M4 5h12v3H4zM4 10.5h12v3H4zM4 16h7" />,
  reviews: <path d="M5 4h10v13l-5-3-5 3zM8 8.5l1.5 1.5L12.5 7" />,
  evaluation: <path d="M4 16V9M8.5 16V5M13 16v-5M17 16V7" />,
  integrations: <path d="M7 7a3 3 0 1 1 0 .01M13 13a3 3 0 1 1 0 .01M9 9l2 2M13 7h3M4 13h3" />,
};

const NAV = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/triage", label: "Manual triage", icon: "triage" },
  { href: "/queue", label: "Ticket queue", icon: "queue" },
  { href: "/reviews", label: "Reviews", icon: "reviews" },
  { href: "/evaluation", label: "Evaluation", icon: "evaluation" },
  { href: "/integrations", label: "Integrations", icon: "integrations" },
];

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function NavLinks({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const { tickets } = useReviewStore();
  const pending = tickets.filter((t) => t.status === "Pending Review" || t.status === "In Review" || t.status === "Approved").length;
  return (
    <nav aria-label={compact ? "Main (mobile)" : "Main"}>
      <ul className={compact ? "flex gap-1 overflow-x-auto" : "space-y-0.5"}>
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-[14px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${
                  active ? "bg-signal text-white shadow-sm" : "text-ink/80 hover:bg-black/[0.05] hover:text-ink"
                }`}
              >
                <Icon name={item.icon} />
                {item.label}
                {item.href === "/reviews" && pending > 0 && (
                  <span className={`ml-auto rounded-full px-1.5 text-[11px] font-semibold ${active ? "bg-white text-signal-strong" : "bg-signal text-white"}`}>{pending}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function StatusRow({ label, value, tone, pulse, title }: { label: string; value: string; tone: StatusTone; pulse?: boolean; title?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 text-xs" title={title}>
      <span className="shrink-0 text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-right font-medium text-ink">
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT[tone]} ${pulse ? "animate-pulse" : ""}`} />
        {value}
      </span>
    </div>
  );
}

/** Compact system status: lives at the bottom of the sidebar instead of a header band. */
function SystemStatus({ backend, inference }: AppHeaderProps) {
  const api = apiStatus(backend);
  const model = modelStatus(inference);
  const provider = inference
    ? inference.is_mock
      ? { value: "Mock", tone: "mock" as const }
      : { value: inference.provider === "gemma" ? "Gemma" : inference.provider, tone: "info" as const }
    : { value: "—", tone: "neutral" as const };
  const triage = inference?.triage;
  return (
    <div className="min-w-0 space-y-2 rounded-xl bg-black/[0.03] p-3">
      <div role="status" aria-label="System status" className="space-y-1.5">
        <StatusRow label="API" value={api.value} tone={api.tone} pulse={api.pulse} />
        <StatusRow label="Provider" value={provider.value} tone={provider.tone} />
        <StatusRow label="Model" value={model.value} tone={model.tone} pulse={model.pulse} title={inference?.detail ?? undefined} />
      </div>
      {inference && (
        <div className="space-y-0.5 border-t border-line pt-2 font-mono text-[10px] leading-4 text-muted">
          <p className="break-all">{inference.model_id}</p>
          {triage && (
            <p className="break-all" title={triage.detail ?? undefined}>
              {triage.available ? `full triage: ${triage.model_id}` : `full triage unavailable${triage.adapter ? ` (${triage.adapter})` : ""}`}
            </p>
          )}
          {inference.device && <p>device: {inference.device}</p>}
        </div>
      )}
    </div>
  );
}

export function AppHeader({ backend, inference }: AppHeaderProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh min-w-0 flex-col gap-6 overflow-y-auto border-r border-black/[0.06] bg-white/60 px-3 py-5 backdrop-blur-xl backdrop-saturate-150 lg:flex">
        <Link href="/" aria-label="TriageLens home" className="rounded-lg px-3 focus-visible:outline-2 focus-visible:outline-signal">
          <Logo />
        </Link>
        <NavLinks />
        <div className="mt-auto">
          <SystemStatus backend={backend} inference={inference} />
        </div>
      </aside>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 border-b border-black/[0.06] bg-white/70 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="mb-2 flex items-center justify-between">
          <Link href="/" aria-label="TriageLens home">
            <Logo />
          </Link>
        </div>
        <NavLinks compact />
      </header>
    </>
  );
}
