// Review-routing destinations (where a triaged incident goes for HUMAN review).
// Review tickets live in this browser tab's memory. After approval, the backend's
// integration layer (sandbox mode) builds the real Slack / Teams / Jira /
// ServiceNow / CRM requests; nothing is sent to a live workspace.

import type { DispatchResult, FullTriageResponse, Severity, TriageRequest } from "./types";

export type DestinationId = "teams" | "crm" | "servicenow" | "jira";

export interface Destination {
  id: DestinationId;
  name: string;
  description: string;
  /** Default team / queue shown on the card. */
  destination: string;
  queues: string[];
  /** Short monogram for the icon tile (no external icon assets). */
  monogram: string;
  tile: string;
}

/** Connection state of every integration until live credentials are configured. */
export const CONNECTION_STATUS = "Sandbox";

export const DESTINATIONS: Destination[] = [
  {
    id: "teams",
    name: "Microsoft Teams",
    description: "Post the incident to a Teams channel for engineer review.",
    destination: "Incident Review Team",
    queues: ["Incident Review Team", "Major Incident Bridge", "Service Desk Leads"],
    monogram: "T",
    tile: "bg-indigo-600 text-white",
  },
  {
    id: "crm",
    name: "CRM",
    description: "Create a case in the IT service CRM for follow-up.",
    destination: "IT Service Management Queue",
    queues: ["IT Service Management Queue", "Escalations Queue", "VIP Support Queue"],
    monogram: "CRM",
    tile: "bg-teal-700 text-white",
  },
  {
    id: "servicenow",
    name: "ServiceNow",
    description: "Open an incident record in the review queue.",
    destination: "IT Incident Review Queue",
    queues: ["IT Incident Review Queue", "Network Operations", "Identity & Access Management", "End-User Computing"],
    monogram: "SN",
    tile: "bg-emerald-700 text-white",
  },
  {
    id: "jira",
    name: "Jira Service Management",
    description: "Raise a request in the IT Operations project.",
    destination: "IT Operations Project",
    queues: ["IT Operations Project", "Platform Engineering", "Security Operations"],
    monogram: "JSM",
    tile: "bg-sky-700 text-white",
  },
];

export const destinationById = (id: DestinationId): Destination =>
  DESTINATIONS.find((d) => d.id === id) as Destination;

export const REVIEW_STATUSES = ["Pending Review", "In Review", "Approved", "Rejected", "With team"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface ReviewDecision {
  reviewer: string;
  approved_severity: Severity;
  notes: string;
  decided_at: string;
}

export type ReviewSource = "Manual triage" | "Ticket queue";

export interface ReviewTicket {
  ticket_id: string;
  created_at: string;
  /** Where the AI analysis came from (and the queue ticket id, when it came from the queue). */
  source: ReviewSource;
  source_ref?: string;
  destination: DestinationId;
  destination_name: string;
  queue: string;
  priority: Severity;
  summary: string;
  review_notes: string;
  status: ReviewStatus;
  /** The incident exactly as submitted for analysis. */
  incident: TriageRequest;
  /** The complete AI analysis returned by the backend. */
  ai_analysis: FullTriageResponse;
  decision?: ReviewDecision;
  /** Result of routing to the owning team's systems (after approval). */
  dispatch?: DispatchResult;
}

export interface ReviewDraft {
  destination: DestinationId | null;
  queue: string;
  priority: Severity;
  summary: string;
  review_notes: string;
}

export type DraftErrors = Partial<Record<"destination" | "queue" | "summary", string>>;

export function validateDraft(draft: ReviewDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.destination) errors.destination = "Choose a destination.";
  if (!draft.queue) errors.queue = "Choose a team or queue.";
  else if (draft.destination && !destinationById(draft.destination).queues.includes(draft.queue)) {
    errors.queue = "Choose a team or queue for this destination.";
  }
  if (draft.summary.trim().length < 10) errors.summary = "Summary must be at least 10 characters.";
  return errors;
}

/** Ticket payload as it would be sent; `ticket_id` is null until submission. */
export function buildTicketPayload(
  draft: ReviewDraft,
  incident: TriageRequest,
  analysis: FullTriageResponse,
  ticketId: string | null,
) {
  const dest = draft.destination ? destinationById(draft.destination) : null;
  return {
    ticket_id: ticketId ?? "(assigned on submission)",
    destination: dest?.name ?? null,
    queue: draft.queue || null,
    priority: draft.priority,
    ai_predicted_severity: analysis.severity,
    summary: draft.summary.trim(),
    review_notes: draft.review_notes.trim(),
    status: "Pending Review" as ReviewStatus,
    incident,
    ai_analysis: {
      ...analysis.analysis,
      model_id: analysis.model_id,
      adapter: analysis.adapter,
      is_mock: analysis.is_mock,
      uncertainty_notes: analysis.uncertainty_notes,
      request_id: analysis.request_id,
    },
  };
}

/** Review ticket created automatically after every full AI analysis (default review queue). */
export function autoReview(
  incident: TriageRequest,
  analysis: FullTriageResponse,
  source: ReviewSource,
  sourceRef?: string,
): Omit<ReviewTicket, "ticket_id" | "created_at" | "status"> {
  const dest = DESTINATIONS[0];
  return {
    source,
    source_ref: sourceRef,
    destination: dest.id,
    destination_name: dest.name,
    queue: dest.destination,
    priority: analysis.severity,
    summary: defaultSummary(incident, analysis),
    review_notes: "",
    incident,
    ai_analysis: analysis,
  };
}

export function defaultSummary(incident: TriageRequest, analysis: FullTriageResponse): string {
  const cause = analysis.root_cause.label ?? analysis.analysis.root_cause;
  return `${incident.title} — AI suggests ${analysis.severity} (${analysis.analysis.category}); suspected cause: ${cause}.`;
}
