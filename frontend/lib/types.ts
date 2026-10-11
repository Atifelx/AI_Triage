// Mirrors backend/app/schemas/*.py. The contract is identical for every
// inference provider (mock or gemma).

export type Severity = "P1" | "P2" | "P3" | "P4";

export type ProviderState = "not_loaded" | "loading" | "ready" | "unavailable";

/** Five-field incident-triage capability (second LoRA adapter on the same base model). */
export interface TriageHealth {
  available: boolean;
  adapter: string | null;
  model_id: string | null;
  prompt_format: string | null;
  detail: string | null;
}

export interface InferenceHealth {
  provider: string;
  model_id: string;
  is_mock: boolean;
  state: ProviderState;
  ready: boolean;
  model_loaded: boolean;
  device: string | null;
  detail: string | null;
  /** Absent on older backends. */
  triage?: TriageHealth | null;
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
  /** Confirmed scope in words; derived from the scope fields when omitted. */
  scope_check?: string;
  additional_context?: string;
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

// ---- Full (five-field) triage (backend/app/schemas/incident.py) ------------

/** The validated model answer, exactly as parsed by the backend. */
export interface TriageAnalysis {
  category: string;
  severity: Severity;
  root_cause: string;
  evidence: string[];
  recommended_actions: string[];
}

export interface FullTriageResponse {
  request_id: string;
  incident_title: string;
  /** Exact incident narrative the model received. */
  incident_text?: string;
  /** Severity to act on: the dedicated severity adapter's answer when it ran. */
  severity: Severity;
  severity_source: "severity_adapter" | "triage_adapter";
  /** The triage adapter's own severity (same as analysis.severity). */
  triage_severity: Severity;
  analysis: TriageAnalysis;
  root_cause: {
    id: string;
    label: string | null;
    /** Taxonomy definition of the root cause (training data), when known. */
    definition?: string | null;
    in_taxonomy: boolean | null;
    taxonomy_category: string | null;
    matches_category: boolean | null;
  };
  evidence_support: { text: string; found_in_incident: boolean }[];
  severity_check: { severity: Severity; model_id: string; agrees: boolean } | null;
  uncertain: boolean;
  uncertainty_notes: string[];
  human_review_required: boolean;
  provider: string;
  model_id: string;
  adapter: string | null;
  prompt_format: string | null;
  is_mock: boolean;
  inference_ms: number;
  created_at: string;
  /** Only when the backend runs with EXPOSE_RAW_OUTPUT=true. */
  raw_output?: string | null;
}

export interface Metric {
  correct: number;
  total: number;
  accuracy: number;
}

export interface TriageEvaluationResponse {
  available: boolean;
  adapter: string | null;
  detail: string;
  source: string | null;
  base_model: Record<string, Metric> | null;
  fine_tuned: Record<string, Metric> | null;
  not_measured: string[];
}

// ---- Post-review routing (backend/app/schemas/dispatch.py) ------------------

export interface Team {
  key: string;
  name: string;
  slack_channel: string;
  teams_channel: string;
  jira_project: string;
  servicenow_group: string;
  crm_queue: string;
  categories: string[];
}

export interface Route {
  team: Team;
  severity: Severity;
  connectors: string[];
  owner_reason: string;
  severity_reason: string;
}

export interface Delivery {
  connector: string;
  connector_name: string;
  action: string;
  target: string;
  method: string;
  endpoint: string;
  payload: Record<string, any>;
}

export interface Receipt {
  status: string;
  /** "sandbox": recorded, not sent to the vendor. */
  mode: string;
  external_ref: string;
  detail: string;
}

export interface DispatchRequest {
  review_ticket_id: string;
  incident: TriageRequest;
  incident_text: string;
  analysis: TriageAnalysis;
  root_cause_label: string | null;
  ai_severity?: Severity;
  approved_severity: Severity;
  reviewer: string;
  review_notes: string;
  model_id: string;
  connectors?: string[] | null;
}

export interface DispatchPreview {
  mode: string;
  route: Route;
  deliveries: Delivery[];
}

export interface DispatchResult {
  dispatch_id: string;
  review_ticket_id: string;
  mode: string;
  created_at: string;
  route: Route;
  results: (Delivery & { receipt: Receipt })[];
}

export interface Connector {
  id: string;
  name: string;
  vendor_api: string;
  mode: string;
  connected: boolean;
  go_live_steps: string[];
  go_live_env: string[];
  used_for: Severity[];
}

export interface IntegrationsCatalog {
  mode: string;
  connectors: Connector[];
  teams: Team[];
  severity_rules: Record<Severity, string[]>;
  severity_reasons: Record<Severity, string>;
}

// ---- Manual-triage examples (GET /api/v1/examples) --------------------------

export interface Example {
  source_id: string;
  title: string;
  description: string;
  affected_service: string;
  affected_users: number;
  affected_departments: string[];
  affected_sites: string[];
  business_impact: string;
  workaround_available: boolean | null;
  diagnostic_evidence: string;
  scope_check: string;
  additional_context: string;
  /** Dataset labels: shown only after inference, never sent to the model. */
  reference: { severity: Severity; category: string; root_cause: string };
}

export interface ExamplesResponse {
  source: string;
  examples: Example[];
}

// ---- Ticket queue full analysis ------------------------------------------------

export interface TicketFullAnalysis {
  ticket_id: string;
  triage: FullTriageResponse;
  expected_severity: Severity;
  expected_category: string | null;
  expected_root_cause: string | null;
  severity_correct: boolean;
  category_correct: boolean | null;
  root_cause_correct: boolean | null;
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
    raw_output?: string;
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
  /** Structured fields for the review ticket; the model receives `description` only. */
  incident?: TriageRequest | null;
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
  mode?: "severity" | "full";
  predicted_category?: string | null;
  predicted_root_cause?: string | null;
  expected_category?: string | null;
  expected_root_cause?: string | null;
  category_correct?: boolean | null;
  root_cause_correct?: boolean | null;
  triage_severity?: Severity | null;
  /** Full analysis; only on the session's current ticket. */
  triage?: FullTriageResponse | null;
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
  /** Tickets analyzed in full (five-field) mode, and their per-field accuracy. */
  full_analyzed?: number;
  field_metrics?: Record<string, { correct: number; total: number }>;
  results: TicketResult[];
}
