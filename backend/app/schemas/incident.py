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
