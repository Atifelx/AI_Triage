"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { BackendStatus } from "@/hooks/useHealth";
import type { InferenceHealth } from "@/lib/types";
import { StatusPill, type StatusTone } from "./StatusPill";

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

const NAV = [
  { href: "/", label: "Manual triage" },
  { href: "/queue", label: "Ticket queue" },
  { href: "/evaluation", label: "Evaluation" },
];

function NavTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-400 ${
                  active
                    ? "border-sky-400 text-white"
                    : "border-transparent text-slate-400 hover:border-slate-600 hover:text-slate-200"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppHeader({ backend, inference }: AppHeaderProps) {
  const api = apiStatus(backend);
  const model = modelStatus(inference);
  const provider = inference
    ? inference.is_mock
      ? { value: "Mock", tone: "mock" as const }
      : { value: inference.provider === "gemma" ? "Gemma" : inference.provider, tone: "info" as const }
    : { value: "—", tone: "neutral" as const };

  return (
    <header className="border-b border-slate-800 bg-slate-950 text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="grid h-10 w-10 place-items-center rounded-lg bg-linear-to-br from-sky-500 to-indigo-600 font-mono text-sm font-bold shadow-inner"
          >
            IT
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">AI Incident Triage</h1>
            <p className="text-xs text-slate-400">Enterprise IT Operations · Local AI inference</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:items-end">
          <div role="status" aria-label="System status" className="flex flex-wrap gap-2">
            <StatusPill label="API" value={api.value} tone={api.tone} pulse={api.pulse} />
            <StatusPill label="Provider" value={provider.value} tone={provider.tone} />
            <StatusPill
              label="Model"
              value={model.value}
              tone={model.tone}
              pulse={model.pulse}
              title={inference?.detail ?? undefined}
            />
          </div>
          {inference && (
            <p className="font-mono text-[11px] text-slate-400">
              {inference.model_id}
              {inference.device ? ` · device: ${inference.device}` : ""}
            </p>
          )}
        </div>
      </div>
      <NavTabs />
    </header>
  );
}
