from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app import __version__
from app.api.deps import get_triage_service
from app.schemas.health import HealthResponse
from app.services.triage_service import TriageService

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(service: TriageService = Depends(get_triage_service)) -> HealthResponse:
    """API liveness plus a truthful, separate view of inference readiness."""
    return HealthResponse(
        status="ok",
        api_version=__version__,
        inference=service.inference_health(),
        timestamp=datetime.now(timezone.utc),
    )
