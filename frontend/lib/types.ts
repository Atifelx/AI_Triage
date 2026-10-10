// Mirrors backend/app/schemas/*.py. The contract is identical for every
// inference provider (mock or gemma).

export type Severity = "P1" | "P2" | "P3" | "P4";

export type ProviderState = "not_loaded" | "loading" | "ready" | "unavailable";

export interface InferenceHealth {
  provider: string;
  model_id: string;
  is_mock: boolean;
  state: ProviderState;
  ready: boolean;
  model_loaded: boolean;
  device: string | null;
  detail: string | null;
}

export interface HealthResponse {
  status: "ok";
  api_version: string;
  inference: InferenceHealth;
  timestamp: string;
}

export interface TriageRequest {
  title: string;
  description: string;
  affected_service: string;
  affected_users: number;
  affected_departments: string[];
  affected_sites: string[];
  business_impact: string;
  /** true = yes, false = no, null = unknown */
  workaround_available: boolean | null;
  diagnostic_evidence: string;
}

export interface TriageResponse {
  request_id: string;
  incident_title: string;
  severity: Severity;
  human_review_required: boolean;
  provider: string;
  model_id: string;
  is_mock: boolean;
  inference_ms: number;
  created_at: string;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id?: string;
    details?: FieldError[];
  };
}

// ---- Ticket queue (backend/app/schemas/ticket.py) --------------------------
// A ticket awaiting analysis never carries its reference label.
export interface Ticket {
  ticket_id: string;
  title: string;
  description: string;
  position: number;
  total: number;
}

export interface NextTicketResponse {
  ticket: Ticket | null;
  exhausted: boolean;
  issued: number;
  total: number;
  message: string | null;
}

export interface TicketResult {
  ticket_id: string;
  title: string;
  request_id: string;
  outcome: "predicted" | "invalid_output";
  predicted_severity: Severity | null;
  expected_severity: Severity;
  correct: boolean | null;
  provider: string;
  model_id: string;
  is_mock: boolean;
  inference_ms: number | null;
  analyzed_at: string;
}

export interface TicketAnalysisResponse {
  request_id: string;
  ticket_id: string;
  incident_title: string;
  severity: Severity;
  human_review_required: boolean;
  provider: string;
  model_id: string;
  is_mock: boolean;
  inference_ms: number;
  created_at: string;
  /** Reference label, attached by the backend only after inference. */
  expected_severity: Severity;
  correct: boolean;
}

export interface TicketSession {
  total: number;
  issued: number;
  analyzed: number;
  exhausted: boolean;
  current: Ticket | null;
  current_analysis: TicketResult | null;
}

export type ConfusionColumn = Severity | "invalid";

export interface EvaluationResponse {
  provider: string;
  model_id: string;
  is_mock: boolean;
  total_tickets: number;
  analyzed: number;
  correct: number;
  invalid_outputs: number;
  accuracy: number | null;
  labels: Severity[];
  /** rows = expected, columns = predicted (+ "invalid") */
  confusion_matrix: Record<Severity, Record<ConfusionColumn, number>>;
  results: TicketResult[];
}
