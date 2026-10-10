import type { ReactNode } from "react";
import type { BackendStatus } from "@/hooks/useHealth";
import { API_BASE_URL } from "@/lib/api";
import type { InferenceHealth } from "@/lib/types";

interface SystemBannerProps {
  backend: BackendStatus;
  inference: InferenceHealth | null;
  error: string | null;
  onRetry: () => void;
}

function Banner({
  tone,
  title,
  children,
  action,
}: {
  tone: "danger" | "info" | "mock";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const styles = {
    danger: "border-red-300 bg-red-50 text-red-900",
    info: "border-sky-300 bg-sky-50 text-sky-900",
    mock: "border-amber-400 bg-amber-50 text-amber-950 mock-stripes",
  }[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${styles}`}
    >
      <div>
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 opacity-90">{children}</div>}
      </div>
      {action}
    </div>
  );
}

const retryButton = (onRetry: () => void, label = "Retry connection") => (
  <button
    type="button"
    onClick={onRetry}
    className="shrink-0 rounded-md border border-current px-3 py-1.5 text-xs font-semibold hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-offset-2"
  >
    {label}
  </button>
);

export function SystemBanner({ backend, inference, error, onRetry }: SystemBannerProps) {
  if (backend === "offline") {
    return (
      <Banner tone="danger" title="Backend unavailable" action={retryButton(onRetry)}>
        {error ?? "The triage API cannot be reached."} Expected at{" "}
        <code className="font-mono text-xs">{API_BASE_URL}</code>. Incidents cannot be analyzed until it is back.
      </Banner>
    );
  }
  if (!inference) return null;

  if (inference.is_mock) {
    return (
      <Banner tone="mock" title="MOCK INFERENCE ACTIVE — results are synthetic">
        Severities come from a fixed rule in the mock provider for integration testing. They are not produced by
        Gemma or any other model and must not be used for real triage.
      </Banner>
    );
  }
  if (inference.state === "loading" || inference.state === "not_loaded") {
    return (
      <Banner tone="info" title="Model loading">
        The API is online, but the {inference.model_id} model is not ready yet. Analysis will be enabled
        automatically when loading completes.
      </Banner>
    );
  }
  if (inference.state === "unavailable") {
    return (
      <Banner tone="danger" title="Model unavailable" action={retryButton(onRetry, "Re-check status")}>
        {inference.detail ?? "The inference provider failed to initialise."} No predictions will be made until
        the backend is fixed and restarted.
      </Banner>
    );
  }
  return null;
}
