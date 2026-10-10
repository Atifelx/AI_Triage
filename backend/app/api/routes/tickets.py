from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Request

from app.api.deps import get_request_id
from app.schemas.errors import ErrorResponse
from app.schemas.ticket import (
    EvaluationResponse,
    NextTicketResponse,
    TicketAnalysisResponse,
    TicketOut,
    TicketResultOut,
    TicketSessionResponse,
)
from app.services.ticket_queue import QueuedTicket, TicketAnalysis, TicketService

router = APIRouter(prefix="/api/v1/tickets", tags=["tickets"])

_UNAVAILABLE = {503: {"model": ErrorResponse, "description": "Ticket file missing or invalid"}}


def get_ticket_service(request: Request) -> TicketService:
    return request.app.state.ticket_service


def _ticket_out(ticket: QueuedTicket, total: int) -> TicketOut:
    # expected_severity is deliberately not part of TicketOut.
    return TicketOut(
        ticket_id=ticket.ticket_id,
        title=ticket.title,
        description=ticket.description,
        position=ticket.position,
        total=total,
    )


def _result_out(r: TicketAnalysis) -> TicketResultOut:
    return TicketResultOut(
        ticket_id=r.ticket_id,
        title=r.title,
        request_id=r.request_id,
        outcome=r.outcome,  # type: ignore[arg-type]
        predicted_severity=r.predicted_severity,
        expected_severity=r.expected_severity,
        correct=r.correct,
        provider=r.provider,
        model_id=r.model_id,
        is_mock=r.is_mock,
        inference_ms=r.inference_ms,
        analyzed_at=r.analyzed_at,
    )


@router.get("/next", response_model=NextTicketResponse, responses=_UNAVAILABLE)
def next_ticket(service: TicketService = Depends(get_ticket_service)) -> NextTicketResponse:
    """Issue the next ticket in file order. Not idempotent: each call advances the
    session, and no ticket is issued twice until POST /api/v1/tickets/reset."""
    queue = service.queue
    ticket, issued = queue.next()
    if ticket is None:
        return NextTicketResponse(
            ticket=None,
            exhausted=True,
            issued=issued,
            total=queue.total,
            message=f"End of queue: all {queue.total} tickets have been issued in this session.",
        )
    return NextTicketResponse(
        ticket=_ticket_out(ticket, queue.total), exhausted=False, issued=issued, total=queue.total
    )


@router.get("/session", response_model=TicketSessionResponse, responses=_UNAVAILABLE)
def session(service: TicketService = Depends(get_ticket_service)) -> TicketSessionResponse:
    """Current session state without advancing the queue (used to restore the UI)."""
    snap = service.queue.snapshot()
    current = snap["current"]
    analysis = snap["current_analysis"]
    return TicketSessionResponse(
        total=snap["total"],
        issued=snap["issued"],
        analyzed=snap["analyzed"],
        exhausted=snap["exhausted"],
        current=_ticket_out(current, snap["total"]) if current else None,
        current_analysis=_result_out(analysis) if analysis else None,
    )


@router.post("/reset", response_model=TicketSessionResponse, responses=_UNAVAILABLE)
def reset(service: TicketService = Depends(get_ticket_service)) -> TicketSessionResponse:
    """Start a new session: queue back to ticket 1, evaluation results cleared."""
    service.queue.reset()
    return session(service)


@router.post(
    "/{ticket_id}/analyze",
    response_model=TicketAnalysisResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Unknown ticket_id"},
        409: {"model": ErrorResponse, "description": "Ticket not issued in this session"},
        500: {"model": ErrorResponse, "description": "Inference failed"},
        502: {"model": ErrorResponse, "description": "Model returned invalid output"},
        503: {"model": ErrorResponse, "description": "Provider or ticket queue unavailable"},
    },
)
def analyze_ticket(
    ticket_id: str = Path(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$"),
    service: TicketService = Depends(get_ticket_service),
    request_id: str = Depends(get_request_id),
) -> TicketAnalysisResponse:
    # Sync handler: model generation runs in FastAPI's worker thread pool.
    r = service.analyze(ticket_id, request_id=request_id)
    if r.predicted_severity is None or r.inference_ms is None or r.correct is None:
        raise RuntimeError("analyze() returned without a prediction")  # unreachable: invalid output raises
    return TicketAnalysisResponse(
        request_id=r.request_id,
        ticket_id=r.ticket_id,
        incident_title=r.title,
        severity=r.predicted_severity,
        human_review_required=True,
        provider=r.provider,
        model_id=r.model_id,
        is_mock=r.is_mock,
        inference_ms=r.inference_ms,
        created_at=r.analyzed_at,
        expected_severity=r.expected_severity,
        correct=r.correct,
    )


@router.get("/evaluation", response_model=EvaluationResponse, responses=_UNAVAILABLE)
def evaluation(service: TicketService = Depends(get_ticket_service)) -> EvaluationResponse:
    data = service.evaluation()
    return EvaluationResponse(**{**data, "results": [_result_out(r) for r in data["results"]]})
