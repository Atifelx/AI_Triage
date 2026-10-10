from __future__ import annotations

from fastapi import APIRouter, Depends, Path

from app.api.deps import get_request_id, get_triage_service
from app.api.errors import NotFoundError
from app.schemas.errors import ErrorResponse
from app.schemas.incident import TriageRequest, TriageResponse
from app.services.triage_service import TriageService

router = APIRouter(prefix="/api/v1", tags=["triage"])

_ERRORS = {
    422: {"model": ErrorResponse, "description": "Invalid request"},
    500: {"model": ErrorResponse, "description": "Inference failed"},
    502: {"model": ErrorResponse, "description": "Model returned invalid output"},
    503: {"model": ErrorResponse, "description": "Provider not ready or unavailable"},
}


# Sync handler on purpose: FastAPI runs it in a worker thread, so blocking model
# generation does not stall the event loop (and /health stays responsive).
@router.post("/triage", response_model=TriageResponse, responses=_ERRORS)
def create_triage(
    payload: TriageRequest,
    service: TriageService = Depends(get_triage_service),
    request_id: str = Depends(get_request_id),
) -> TriageResponse:
    return service.triage(payload, request_id=request_id)


@router.get(
    "/triage/{request_id}",
    response_model=TriageResponse,
    responses={404: {"model": ErrorResponse, "description": "Unknown request id"}},
)
def get_triage(
    request_id: str = Path(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"),
    service: TriageService = Depends(get_triage_service),
) -> TriageResponse:
    """Return a result from this process's in-memory history (lost on restart)."""
    result = service.get_result(request_id)
    if result is None:
        raise NotFoundError("No triage result with this request_id (history is in-memory only).")
    return result
