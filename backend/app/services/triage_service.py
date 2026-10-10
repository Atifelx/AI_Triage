"""Triage service: maps API requests to provider calls and builds responses.

Depends only on the `InferenceProvider` interface.
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from datetime import datetime, timezone

from app.schemas.health import InferenceHealth
from app.schemas.incident import TriageRequest, TriageResponse
from app.services.errors import InferenceError
from app.services.providers.base import IncidentInput, InferenceProvider

logger = logging.getLogger(__name__)


class RecentResults:
    """Bounded, process-local store for GET /api/v1/triage/{request_id}.

    In-memory only: cleared on restart, not shared between worker processes.
    """

    def __init__(self, max_items: int) -> None:
        self._max = max_items
        self._items: OrderedDict[str, TriageResponse] = OrderedDict()
        self._lock = threading.Lock()

    def add(self, result: TriageResponse) -> None:
        with self._lock:
            self._items[result.request_id] = result
            while len(self._items) > self._max:
                self._items.popitem(last=False)

    def get(self, request_id: str) -> TriageResponse | None:
        with self._lock:
            return self._items.get(request_id)


class TriageService:
    def __init__(self, provider: InferenceProvider, history_size: int = 200) -> None:
        self._provider = provider
        self._history = RecentResults(history_size)

    @property
    def provider(self) -> InferenceProvider:
        return self._provider

    def inference_health(self) -> InferenceHealth:
        status = self._provider.status()
        return InferenceHealth(
            provider=self._provider.name,
            model_id=self._provider.model_id,
            is_mock=self._provider.is_mock,
            state=status.state.value,
            ready=status.ready,
            model_loaded=status.model_loaded,
            device=status.device,
            detail=status.detail,
        )

    def triage(self, request: TriageRequest, *, request_id: str) -> TriageResponse:
        incident = IncidentInput(
            title=request.title,
            description=request.description,
            affected_service=request.affected_service,
            affected_users=request.affected_users,
            business_impact=request.business_impact,
            affected_departments=tuple(request.affected_departments),
            affected_sites=tuple(request.affected_sites),
            workaround_available=request.workaround_available,
            diagnostic_evidence=request.diagnostic_evidence,
        )
        try:
            prediction = self._provider.predict_severity(incident)
        except InferenceError as exc:
            logger.warning(
                "Triage inference error",
                extra={
                    "request_id": request_id,
                    "provider": self._provider.name,
                    "error_code": exc.code,
                    "detail": exc.internal_detail,
                },
            )
            raise

        response = TriageResponse(
            request_id=request_id,
            incident_title=request.title,
            severity=prediction.severity,
            human_review_required=True,
            provider=self._provider.name,
            model_id=self._provider.model_id,
            is_mock=self._provider.is_mock,
            inference_ms=prediction.inference_ms,
            created_at=datetime.now(timezone.utc),
        )
        self._history.add(response)
        # Incident text is intentionally not logged.
        logger.info(
            "Triage completed",
            extra={
                "request_id": request_id,
                "provider": response.provider,
                "severity": response.severity,
                "inference_ms": response.inference_ms,
            },
        )
        return response

    def get_result(self, request_id: str) -> TriageResponse | None:
        return self._history.get(request_id)
