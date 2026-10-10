import { vi } from "vitest";
import type { HealthResponse, InferenceHealth, TriageResponse } from "@/lib/types";

/** Minimal stand-in for fetch's Response (only what lib/api.ts uses). */
export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  } as unknown as Response;
}

export const MOCK_INFERENCE: InferenceHealth = {
  provider: "mock",
  model_id: "mock-synthetic-rules-v1",
  is_mock: true,
  state: "ready",
  ready: true,
  model_loaded: false,
  device: null,
  detail: "Mock provider active: results are synthetic and not produced by any model.",
};

export const GEMMA_READY: InferenceHealth = {
  provider: "gemma",
  model_id: "google/gemma-3-270m-it + LoRA:gemma3-270m-severity-lora",
  is_mock: false,
  state: "ready",
  ready: true,
  model_loaded: true,
  device: "mps",
  detail: "Model loaded.",
};

export function health(inference: InferenceHealth): HealthResponse {
  return { status: "ok", api_version: "0.1.0", inference, timestamp: "2026-10-10T10:00:00Z" };
}

export function triageResult(overrides: Partial<TriageResponse> = {}): TriageResponse {
  return {
    request_id: "a1b2c3",
    incident_title: "Microsoft 365 sign-in failures",
    severity: "P1",
    human_review_required: true,
    provider: "mock",
    model_id: "mock-synthetic-rules-v1",
    is_mock: true,
    inference_ms: 401.2,
    created_at: "2026-10-10T10:00:00Z",
    ...overrides,
  };
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;
type PathHandler = (path: string, init?: RequestInit) => Response | Promise<Response>;

/** Routes fetch calls by path. Unrouted calls fail like an unreachable server. */
export function stubFetch(routes: { health?: Handler; triage?: Handler; tickets?: PathHandler }) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/health") && routes.health) return routes.health(init);
    if (url.endsWith("/api/v1/triage") && routes.triage) return routes.triage(init);
    if (url.includes("/api/v1/tickets") && routes.tickets) {
      return routes.tickets(new URL(url).pathname.replace("/api/v1/tickets", ""), init);
    }
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export const triageCalls = (fn: ReturnType<typeof stubFetch>) =>
  fn.mock.calls.filter(([input]) => String(input).endsWith("/api/v1/triage"));
