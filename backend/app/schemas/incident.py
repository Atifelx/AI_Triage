"""Public request/response contract for incident triage.

This contract is independent of the inference implementation: switching
INFERENCE_PROVIDER between mock and gemma does not change these shapes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

Severity = Literal["P1", "P2", "P3", "P4"]

# Field limits (mirrored in frontend/lib/validation.ts).
TITLE_MAX = 200
DESCRIPTION_MAX = 4000
SERVICE_MAX = 120
IMPACT_MAX = 2000
EVIDENCE_MAX = 4000
SCOPE_MAX = 1000
LIST_MAX_ITEMS = 20
LIST_ITEM_MAX = 80
USERS_MAX = 1_000_000

ListItem = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=LIST_ITEM_MAX)
]


class TriageRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        json_schema_extra={
            "example": {
                "title": "Microsoft 365 sign-in failures",
                "description": "Multiple employees cannot sign in.",
                "affected_service": "Microsoft 365",
                "affected_users": 45,
                "affected_departments": ["Finance", "Operations"],
                "affected_sites": ["Mumbai", "Pune"],
                "business_impact": "Employees cannot access business applications.",
                "workaround_available": False,
                "diagnostic_evidence": "Authentication failures reported by affected users.",
            }
        },
    )

    title: str = Field(min_length=3, max_length=TITLE_MAX)
    description: str = Field(min_length=10, max_length=DESCRIPTION_MAX)
    affected_service: str = Field(min_length=2, max_length=SERVICE_MAX)
    affected_users: int = Field(ge=0, le=USERS_MAX, strict=True)
    affected_departments: list[ListItem] = Field(default_factory=list, max_length=LIST_MAX_ITEMS)
    affected_sites: list[ListItem] = Field(default_factory=list, max_length=LIST_MAX_ITEMS)
    business_impact: str = Field(min_length=5, max_length=IMPACT_MAX)
    workaround_available: bool | None = Field(
        default=None, description="true = yes, false = no, null = unknown", strict=True
    )
    diagnostic_evidence: str = Field(default="", max_length=EVIDENCE_MAX)
    scope_check: str = Field(
        default="", max_length=SCOPE_MAX, description="Confirmed scope; derived from the scope fields when empty"
    )
    additional_context: str = Field(default="", max_length=SCOPE_MAX)

    @field_validator("affected_departments", "affected_sites")
    @classmethod
    def _no_duplicates(cls, items: list[str]) -> list[str]:
        seen: set[str] = set()
        for item in items:
            key = item.casefold()
            if key in seen:
                raise ValueError(f"duplicate entry: {item!r}")
            seen.add(key)
        return items


class TriageResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    request_id: str
    incident_title: str
    severity: Severity
    human_review_required: bool = Field(
        description="Always true: severity is an AI suggestion that a human must confirm."
    )
    provider: str
    model_id: str
    is_mock: bool = Field(description="True when the result is synthetic (mock provider).")
    inference_ms: float = Field(ge=0)
    created_at: datetime


# ---- Full (five-field) incident triage ---------------------------------------


class TriageAnalysisOut(BaseModel):
    """The validated five-field model answer, exactly as parsed (nothing added)."""

    category: str
    severity: Severity
    root_cause: str
    evidence: list[str]
    recommended_actions: list[str]


class RootCauseOut(BaseModel):
    id: str = Field(description="root_cause exactly as returned by the model")
    label: str | None = Field(description="Human-readable label from the training taxonomy, if known")
    definition: str | None = Field(default=None, description="Taxonomy definition of this root cause")
    in_taxonomy: bool | None = Field(description="null when the adapter has no published taxonomy")
    taxonomy_category: str | None = None
    matches_category: bool | None = None


class EvidenceSupportOut(BaseModel):
    text: str
    found_in_incident: bool = Field(
        description="True if the item is stated in the submitted incident; false = model inference"
    )


class SeverityCheckOut(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    severity: Severity
    model_id: str = Field(description="The dedicated severity adapter that produced this check")
    agrees: bool


class FullTriageResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    request_id: str
    incident_title: str
    incident_text: str = Field(description="Exact incident narrative sent to the model (for highlighting proof)")
    severity: Severity = Field(description="Severity to act on: the dedicated severity adapter's answer when available")
    severity_source: Literal["severity_adapter", "triage_adapter"] = Field(
        description="Which adapter produced `severity`"
    )
    triage_severity: Severity = Field(description="The triage adapter's own severity (analysis.severity)")
    analysis: TriageAnalysisOut
    root_cause: RootCauseOut
    evidence_support: list[EvidenceSupportOut]
    severity_check: SeverityCheckOut | None = Field(
        description="The severity adapter's answer (source of `severity`); null if disabled or it failed"
    )
    uncertain: bool = Field(description="True when any uncertainty note applies")
    uncertainty_notes: list[str]
    human_review_required: bool = Field(description="Always true")
    provider: str
    model_id: str = Field(description="Base model + the triage adapter that produced `analysis`")
    adapter: str | None
    prompt_format: str | None
    is_mock: bool
    inference_ms: float = Field(ge=0)
    created_at: datetime
    raw_output: str | None = Field(
        default=None, description="Exact generated text; only when EXPOSE_RAW_OUTPUT is enabled"
    )


class MetricOut(BaseModel):
    correct: int
    total: int
    accuracy: float


class TriageEvaluationResponse(BaseModel):
    """Offline evaluation of the configured triage adapter (no fabricated metrics)."""

    available: bool
    adapter: str | None
    detail: str
    source: str | None = None
    base_model: dict[str, MetricOut] | None = None
    fine_tuned: dict[str, MetricOut] | None = None
    not_measured: list[str] = Field(default_factory=list)
