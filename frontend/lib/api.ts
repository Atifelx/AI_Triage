import type {
  ErrorEnvelope,
  EvaluationResponse,
  FieldError,
  HealthResponse,
  NextTicketResponse,
  TicketAnalysisResponse,
  TicketSession,
  TriageRequest,
  TriageResponse,
} from "./types";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"
).replace(/\/+$/, "");

const HEALTH_TIMEOUT_MS = 5_000;
// CPU inference on a small laptop can take a few seconds; allow generous headroom.
const TRIAGE_TIMEOUT_MS = 120_000;

export type ApiErrorKind =
  | "network" // backend unreachable / CORS / timeout
  | "validation" // 422
  | "not_ready" // 503 provider_not_ready (model still loading)
  | "unavailable" // 503 provider_unavailable (model failed to load)
  | "inference" // 500 inference_failed
  | "invalid_output" // 502 invalid_model_output
  | "not_found" // 404
  | "conflict" // 409 ticket_not_issued
  | "queue_unavailable" // 503 tickets_unavailable
  | "unknown";

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly status: number | null = null,
    public readonly code: string | null = null,
    public readonly requestId: string | null = null,
    public readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Whether resubmitting the same request could reasonably succeed. */
  get retryable(): boolean {
    return this.kind !== "validation";
  }
}

const KIND_BY_CODE: Record<string, ApiErrorKind> = {
  validation_error: "validation",
  invalid_json: "validation",
  provider_not_ready: "not_ready",
  provider_unavailable: "unavailable",
  inference_failed: "inference",
  invalid_model_output: "invalid_output",
  not_found: "not_found",
  ticket_not_issued: "conflict",
  tickets_unavailable: "queue_unavailable",
};

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

interface RequestOptions {
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, init: RequestOptions, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const outerSignal = init.signal;
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onOuterAbort);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: init.method,
      body: init.body,
      signal: controller.signal,
      headers: { Accept: "application/json", ...init.headers },
    });
  } catch (err) {
    const timedOut = controller.signal.aborted && !outerSignal?.aborted;
    if (outerSignal?.aborted) throw err; // caller cancelled; not an API failure
    throw new ApiError(
      "network",
      timedOut
        ? "The backend did not respond in time."
        : `Cannot reach the triage API at ${API_BASE_URL}. Check that the backend is running.`,
    );
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.ok) {
    if (body === null) {
      throw new ApiError("unknown", "The backend returned an empty or non-JSON response.", response.status);
    }
    return body as T;
  }

  if (isErrorEnvelope(body)) {
    const { code, message, request_id, details } = body.error;
    throw new ApiError(
      KIND_BY_CODE[code] ?? "unknown",
      message,
      response.status,
      code,
      request_id ?? null,
      details ?? [],
    );
  }
  throw new ApiError("unknown", `Unexpected response from the backend (HTTP ${response.status}).`, response.status);
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>("/health", { method: "GET", signal }, HEALTH_TIMEOUT_MS);
}

export function submitTriage(payload: TriageRequest, signal?: AbortSignal): Promise<TriageResponse> {
  return request<TriageResponse>(
    "/api/v1/triage",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    },
    TRIAGE_TIMEOUT_MS,
  );
}

export function getTriage(requestId: string, signal?: AbortSignal): Promise<TriageResponse> {
  return request<TriageResponse>(
    `/api/v1/triage/${encodeURIComponent(requestId)}`,
    { method: "GET", signal },
    HEALTH_TIMEOUT_MS,
  );
}

// ---- Ticket queue ----------------------------------------------------------

/** Issues the next ticket. Not idempotent: each call advances the session. */
export function getNextTicket(signal?: AbortSignal): Promise<NextTicketResponse> {
  return request<NextTicketResponse>("/api/v1/tickets/next", { method: "GET", signal }, HEALTH_TIMEOUT_MS);
}

/** Current session state without advancing the queue. */
export function getTicketSession(signal?: AbortSignal): Promise<TicketSession> {
  return request<TicketSession>("/api/v1/tickets/session", { method: "GET", signal }, HEALTH_TIMEOUT_MS);
}

export function resetTicketSession(): Promise<TicketSession> {
  return request<TicketSession>("/api/v1/tickets/reset", { method: "POST" }, HEALTH_TIMEOUT_MS);
}

export function analyzeTicket(ticketId: string, signal?: AbortSignal): Promise<TicketAnalysisResponse> {
  return request<TicketAnalysisResponse>(
    `/api/v1/tickets/${encodeURIComponent(ticketId)}/analyze`,
    { method: "POST", signal },
    TRIAGE_TIMEOUT_MS,
  );
}

export function getEvaluation(signal?: AbortSignal): Promise<EvaluationResponse> {
  return request<EvaluationResponse>("/api/v1/tickets/evaluation", { method: "GET", signal }, HEALTH_TIMEOUT_MS);
}
