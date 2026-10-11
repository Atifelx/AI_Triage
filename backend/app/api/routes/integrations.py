from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, Request

from app.api.errors import BadRequestError
from app.schemas.dispatch import (
    ConnectorOut,
    DeliveryOut,
    DeliveryResultOut,
    DispatchPreviewResponse,
    DispatchRequest,
    DispatchResponse,
    IntegrationsResponse,
    ReceiptOut,
    RouteOut,
    TeamOut,
)
from app.schemas.errors import ErrorResponse
from app.services.integrations.connectors import Delivery, DispatchContext
from app.services.integrations.routing import SEVERITY_FANOUT, SEVERITY_REASON, TEAMS, RoutePlan, Team, plan_route
from app.services.integrations.service import IntegrationService, UnknownConnectorError

router = APIRouter(prefix="/api/v1", tags=["integrations"])


def get_integrations(request: Request) -> IntegrationService:
    return request.app.state.integration_service


def _team(team: Team) -> TeamOut:
    data = asdict(team)
    data["categories"] = list(team.categories)
    return TeamOut(**data)


def _route(route: RoutePlan) -> RouteOut:
    return RouteOut(
        team=_team(route.team),
        severity=route.severity,
        connectors=list(route.connectors),
        owner_reason=route.owner_reason,
        severity_reason=route.severity_reason,
    )


def _delivery(d: Delivery) -> DeliveryOut:
    return DeliveryOut(**asdict(d))


def _context(req: DispatchRequest) -> DispatchContext:
    a = req.analysis
    return DispatchContext(
        review_ticket_id=req.review_ticket_id,
        title=req.incident.title,
        incident_text=req.incident_text,
        affected_service=req.incident.affected_service,
        affected_users=req.incident.affected_users,
        category=a.category,
        ai_severity=req.ai_severity or a.severity,
        approved_severity=req.approved_severity,
        root_cause=a.root_cause,
        root_cause_label=req.root_cause_label or a.root_cause.replace("_", " "),
        evidence=tuple(a.evidence),
        recommended_actions=tuple(a.recommended_actions),
        reviewer=req.reviewer,
        review_notes=req.review_notes,
        model_id=req.model_id,
        route=plan_route(a.category, req.approved_severity),
    )


@router.get("/integrations", response_model=IntegrationsResponse)
def list_integrations(service: IntegrationService = Depends(get_integrations)) -> IntegrationsResponse:
    used_for = {
        cid: [sev for sev, conns in SEVERITY_FANOUT.items() if cid in conns] for cid in service.connectors
    }
    return IntegrationsResponse(
        mode=service.MODE,
        connectors=[
            ConnectorOut(
                id=c.id,
                name=c.name,
                vendor_api=c.vendor_api,
                mode=service.MODE,
                connected=False,
                go_live_steps=c.go_live["steps"],
                go_live_env=c.go_live["env"],
                used_for=used_for[c.id],
            )
            for c in service.connectors.values()
        ],
        teams=[_team(t) for t in TEAMS],
        severity_rules={k: list(v) for k, v in SEVERITY_FANOUT.items()},
        severity_reasons=SEVERITY_REASON,
    )


@router.post("/dispatch/preview", response_model=DispatchPreviewResponse)
def preview_dispatch(
    payload: DispatchRequest, service: IntegrationService = Depends(get_integrations)
) -> DispatchPreviewResponse:
    """Routing plan and exact API requests for an approved ticket. No side effects."""
    ctx = _context(payload)
    return DispatchPreviewResponse(
        mode=service.MODE, route=_route(ctx.route), deliveries=[_delivery(d) for d in service.preview(ctx)]
    )


@router.post(
    "/dispatch",
    response_model=DispatchResponse,
    responses={400: {"model": ErrorResponse, "description": "Unknown connector"}},
)
def dispatch(payload: DispatchRequest, service: IntegrationService = Depends(get_integrations)) -> DispatchResponse:
    """Send an approved ticket to the owning team's systems (sandbox: recorded, not sent)."""
    try:
        record = service.dispatch(_context(payload), payload.connectors)
    except UnknownConnectorError as exc:
        raise BadRequestError(str(exc)) from exc
    return DispatchResponse(
        dispatch_id=record.dispatch_id,
        review_ticket_id=record.review_ticket_id,
        mode=service.MODE,
        created_at=record.created_at,
        route=_route(record.route),
        results=[
            DeliveryResultOut(**asdict(d), receipt=ReceiptOut(**asdict(r))) for d, r in record.results
        ],
    )
