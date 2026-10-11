"""Contracts for post-review routing (Slack / Teams / Jira / ServiceNow / CRM)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.incident import Severity, TriageAnalysisOut, TriageRequest


class DispatchRequest(BaseModel):
    """A human-approved review ticket. The analysis is the AI output the reviewer approved."""

    model_config = ConfigDict(extra="forbid", protected_namespaces=())

    review_ticket_id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    incident: TriageRequest
    incident_text: str = Field(min_length=1, max_length=8000)
    analysis: TriageAnalysisOut
    root_cause_label: str | None = None
    ai_severity: Severity | None = Field(default=None, description="Severity the AI suggested; defaults to analysis.severity")
    approved_severity: Severity
    reviewer: str = Field(min_length=2, max_length=80)
    review_notes: str = Field(default="", max_length=2000)
    model_id: str = Field(default="", max_length=200)
    connectors: list[str] | None = Field(
        default=None, description="Subset of the planned connectors to send to; null = all planned"
    )


class TeamOut(BaseModel):
    key: str
    name: str
    slack_channel: str
    teams_channel: str
    jira_project: str
    servicenow_group: str
    crm_queue: str
    categories: list[str]


class RouteOut(BaseModel):
    team: TeamOut
    severity: Severity
    connectors: list[str]
    owner_reason: str
    severity_reason: str


class DeliveryOut(BaseModel):
    connector: str
    connector_name: str
    action: str
    target: str
    method: str
    endpoint: str
    payload: dict[str, Any]


class ReceiptOut(BaseModel):
    status: str
    mode: str = Field(description="'sandbox': recorded, not sent")
    external_ref: str
    detail: str


class DeliveryResultOut(DeliveryOut):
    receipt: ReceiptOut


class DispatchPreviewResponse(BaseModel):
    mode: str
    route: RouteOut
    deliveries: list[DeliveryOut]


class DispatchResponse(BaseModel):
    dispatch_id: str
    review_ticket_id: str
    mode: str
    created_at: datetime
    route: RouteOut
    results: list[DeliveryResultOut]


class ConnectorOut(BaseModel):
    id: str
    name: str
    vendor_api: str
    mode: str
    connected: bool = Field(description="False in sandbox mode: no live workspace is connected")
    go_live_steps: list[str]
    go_live_env: list[str]
    used_for: list[str]


class IntegrationsResponse(BaseModel):
    mode: str
    connectors: list[ConnectorOut]
    teams: list[TeamOut]
    severity_rules: dict[str, list[str]]
    severity_reasons: dict[str, str]
