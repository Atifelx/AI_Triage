"""Contracts for the local ticket queue and its evaluation.

`expected_severity` never appears on a ticket that is about to be analyzed
(`TicketOut`); it is only returned after inference, for evaluation.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.incident import FullTriageResponse, Severity, TriageRequest


class TicketOut(BaseModel):
    ticket_id: str
    title: str
    description: str
    position: int = Field(description="1-based position in the queue")
    total: int
    incident: TriageRequest | None = Field(
        default=None, description="Structured fields for the review ticket; the model receives `description` only"
    )


class NextTicketResponse(BaseModel):
    ticket: TicketOut | None = Field(description="null once the queue is exhausted")
    exhausted: bool
    issued: int
    total: int
    message: str | None = None


class TicketResultOut(BaseModel):
    """One analyzed ticket, as stored for evaluation."""

    model_config = ConfigDict(protected_namespaces=())

    ticket_id: str
    title: str
    request_id: str
    outcome: Literal["predicted", "invalid_output"]
    predicted_severity: Severity | None
    expected_severity: Severity
    correct: bool | None
    provider: str
    model_id: str
    is_mock: bool
    inference_ms: float | None
    analyzed_at: datetime
    mode: Literal["severity", "full"] = "severity"
    predicted_category: str | None = None
    predicted_root_cause: str | None = None
    expected_category: str | None = None
    expected_root_cause: str | None = None
    category_correct: bool | None = None
    root_cause_correct: bool | None = None
    triage_severity: Severity | None = Field(default=None, description="Triage adapter's own severity (full mode)")
    triage: FullTriageResponse | None = Field(default=None, description="Full analysis (session view only)")


class TicketFullAnalysisResponse(BaseModel):
    """POST /api/v1/tickets/{ticket_id}/analyze/full — reference labels attached after inference."""

    ticket_id: str
    triage: FullTriageResponse
    expected_severity: Severity
    expected_category: str | None
    expected_root_cause: str | None
    severity_correct: bool
    category_correct: bool | None
    root_cause_correct: bool | None


class TicketAnalysisResponse(BaseModel):
    """POST /api/v1/tickets/{ticket_id}/analyze — mirrors TriageResponse field names."""

    model_config = ConfigDict(protected_namespaces=())

    request_id: str
    ticket_id: str
    incident_title: str
    severity: Severity = Field(description="Predicted severity returned by the provider")
    human_review_required: bool
    provider: str
    model_id: str
    is_mock: bool = Field(description="True when the result is synthetic (mock provider)")
    inference_ms: float = Field(ge=0)
    created_at: datetime
    expected_severity: Severity = Field(description="Reference label, attached after inference")
    correct: bool


class TicketSessionResponse(BaseModel):
    total: int
    issued: int
    analyzed: int
    exhausted: bool
    current: TicketOut | None
    current_analysis: TicketResultOut | None


class EvaluationResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    provider: str
    model_id: str
    is_mock: bool
    total_tickets: int
    analyzed: int
    correct: int
    invalid_outputs: int
    accuracy: float | None = Field(description="correct / analyzed; invalid outputs count as incorrect")
    labels: list[Severity]
    confusion_matrix: dict[str, dict[str, int]] = Field(
        description="rows = expected severity, columns = predicted severity plus 'invalid'"
    )
    full_analyzed: int = 0
    field_metrics: dict[str, dict[str, int]] = Field(
        default_factory=dict, description="Full-mode accuracy per field: {correct, total}"
    )
    results: list[TicketResultOut]
