"""Triage service: maps API requests to provider calls and builds responses.

Depends only on the `InferenceProvider` interface.
"""

from __future__ import annotations

import json
import logging
import threading
from collections import OrderedDict
from datetime import datetime, timezone
from collections.abc import Callable
from pathlib import Path

from app.schemas.health import InferenceHealth, TriageHealth
from app.schemas.incident import (
    EvidenceSupportOut,
    FullTriageResponse,
    MetricOut,
    RootCauseOut,
    SeverityCheckOut,
    TriageAnalysisOut,
    TriageEvaluationResponse,
    TriageRequest,
    TriageResponse,
)
from app.services.errors import InferenceError, InvalidModelOutputError
from app.services.providers.base import IncidentInput, InferenceProvider, SeverityPrediction, TriagePrediction
from app.services.providers.gemma_prompt import render_incident_text
from app.services.triage_parser import assess_triage

#: Offline metrics file shipped next to a triage adapter (see backend/models/*/README.md).
EVALUATION_FILE = "evaluation_metrics.json"
NOT_MEASURED = [
    "Evidence quality / support (no labelled evaluation exists)",
    "Recommended-action quality and safety (no labelled evaluation exists)",
]

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


def _request_to_incident(request: TriageRequest) -> IncidentInput:
    return IncidentInput(
        title=request.title,
        description=request.description,
        affected_service=request.affected_service,
        affected_users=request.affected_users,
        business_impact=request.business_impact,
        affected_departments=tuple(request.affected_departments),
        affected_sites=tuple(request.affected_sites),
        workaround_available=request.workaround_available,
        diagnostic_evidence=request.diagnostic_evidence,
        scope_check=request.scope_check,
        additional_context=request.additional_context,
    )


def load_offline_evaluation(adapter_dir: Path | None, adapter: str | None) -> TriageEvaluationResponse:
    """Metrics measured offline for the configured triage adapter, or an explicit
    'unavailable' result. Nothing is estimated or invented."""
    if adapter_dir is None:
        return TriageEvaluationResponse(
            available=False, adapter=None, detail="No incident-triage adapter is configured.", not_measured=NOT_MEASURED
        )
    path = adapter_dir.parent / EVALUATION_FILE
    if not path.is_file():
        return TriageEvaluationResponse(
            available=False,
            adapter=adapter,
            detail=f"No offline evaluation file ({EVALUATION_FILE}) is shipped with this adapter.",
            not_measured=NOT_MEASURED,
        )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))

        def metrics(block: dict) -> dict[str, MetricOut]:
            return {
                name: MetricOut(correct=int(m["correct"]), total=int(m["total"]), accuracy=m["correct"] / m["total"])
                for name, m in block.items()
                if int(m["total"]) > 0
            }

        return TriageEvaluationResponse(
            available=True,
            adapter=adapter,
            detail="Measured offline by training/scripts/evaluate_lora_v3.py on the held-out synthetic test split.",
            source=f"backend/models/{adapter_dir.parent.name}/{EVALUATION_FILE}",
            base_model=metrics(data["base"]),
            fine_tuned=metrics(data["lora"]),
            not_measured=NOT_MEASURED,
        )
    except (OSError, ValueError, KeyError, TypeError, ZeroDivisionError):
        logger.exception("Could not read triage evaluation file")
        return TriageEvaluationResponse(
            available=False,
            adapter=adapter,
            detail=f"The evaluation file {EVALUATION_FILE} could not be read.",
            not_measured=NOT_MEASURED,
        )


class TriageService:
    def __init__(
        self,
        provider: InferenceProvider,
        history_size: int = 200,
        *,
        severity_cross_check: bool = True,
        expose_raw_output: bool = False,
        triage_adapter_dir: Path | None = None,
    ) -> None:
        self._provider = provider
        self._history = RecentResults(history_size)
        self._severity_cross_check = severity_cross_check
        self._expose_raw_output = expose_raw_output
        self._triage_adapter_dir = triage_adapter_dir

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
            triage=self._triage_health(),
        )

    def _triage_health(self) -> TriageHealth:
        cap = self._provider.triage_capability()
        return TriageHealth(
            available=cap.available and self._provider.is_ready(),
            adapter=cap.adapter,
            model_id=cap.model_id,
            prompt_format=cap.prompt_format,
            detail=cap.detail,
        )

    def triage_evaluation(self) -> TriageEvaluationResponse:
        if self._provider.is_mock:
            return TriageEvaluationResponse(
                available=False,
                adapter=None,
                detail="Mock provider: there is no model, so there is nothing to evaluate.",
                not_measured=NOT_MEASURED,
            )
        return load_offline_evaluation(self._triage_adapter_dir, self._provider.triage_capability().adapter)

    def full_triage(self, request: TriageRequest, *, request_id: str) -> FullTriageResponse:
        incident = _request_to_incident(request)
        return self._full(
            title=request.title,
            incident_text=render_incident_text(incident),
            diagnostic_evidence_supplied=bool(request.diagnostic_evidence.strip()),
            predict=lambda: self._provider.predict_triage(incident),
            check=lambda: self._provider.predict_severity(incident),
            request_id=request_id,
        )

    def full_triage_text(self, *, title: str, incident_text: str, request_id: str) -> FullTriageResponse:
        """Full triage of a free-text ticket narrative (the ticket queue)."""
        return self._full(
            title=title,
            incident_text=incident_text,
            diagnostic_evidence_supplied="diagnostic evidence:" in incident_text.lower(),
            predict=lambda: self._provider.predict_triage_from_text(incident_text),
            check=lambda: self._provider.predict_severity_from_text(incident_text),
            request_id=request_id,
        )

    def _full(
        self,
        *,
        title: str,
        incident_text: str,
        diagnostic_evidence_supplied: bool,
        predict: Callable[[], TriagePrediction],
        check: Callable[[], SeverityPrediction],
        request_id: str,
    ) -> FullTriageResponse:
        try:
            prediction = predict()
        except InferenceError as exc:
            logger.warning(
                "Full triage inference error",
                extra={
                    "request_id": request_id,
                    "provider": self._provider.name,
                    "error_code": exc.code,
                    "detail": exc.internal_detail,
                },
            )
            if isinstance(exc, InvalidModelOutputError) and not self._expose_raw_output:
                exc.raw_output = None
            raise

        severity_check: SeverityCheckOut | None = None
        if self._severity_cross_check:
            try:
                checked = check()
                severity_check = SeverityCheckOut(
                    severity=checked.severity,
                    model_id=self._provider.model_id,
                    agrees=checked.severity == prediction.analysis.severity,
                )
            except InferenceError as exc:
                logger.warning("Severity cross-check failed", extra={"request_id": request_id, "error_code": exc.code})

        analysis = prediction.analysis
        profile = self._provider.triage_profile()
        assert profile is not None  # predict_triage() already required it
        # Severity comes from the dedicated severity adapter (100% on held-out data) and the
        # other four fields from the triage adapter (whose own severity scored ~45%). A
        # disagreement is therefore expected and shown in the UI, not treated as uncertainty.
        assessment = assess_triage(
            analysis,
            profile,
            incident_text=incident_text,
            diagnostic_evidence_supplied=diagnostic_evidence_supplied,
            severity_check=None,
        )
        notes = list(assessment.notes)
        if severity_check is not None:
            final_severity, source = severity_check.severity, "severity_adapter"
        else:
            final_severity, source = analysis.severity, "triage_adapter"
            notes.append(
                "The severity adapter could not be run, so severity comes from the triage adapter, which is "
                "less reliable for severity. Confirm it manually."
            )

        response = FullTriageResponse(
            request_id=request_id,
            incident_title=title,
            incident_text=incident_text,
            severity=final_severity,
            severity_source=source,  # type: ignore[arg-type]
            triage_severity=analysis.severity,
            analysis=TriageAnalysisOut(**analysis.as_dict()),  # type: ignore[arg-type]
            root_cause=RootCauseOut(
                id=analysis.root_cause,
                label=assessment.root_cause.label,
                definition=assessment.root_cause.definition,
                in_taxonomy=assessment.root_cause.in_taxonomy,
                taxonomy_category=assessment.root_cause.taxonomy_category,
                matches_category=assessment.root_cause.matches_category,
            ),
            evidence_support=[
                EvidenceSupportOut(text=text, found_in_incident=found)
                for text, found in zip(analysis.evidence, assessment.evidence_found)
            ],
            severity_check=severity_check,
            uncertain=bool(notes),
            uncertainty_notes=notes,
            human_review_required=True,
            provider=self._provider.name,
            model_id=prediction.model_id,
            adapter=prediction.adapter,
            prompt_format=prediction.prompt_format,
            is_mock=self._provider.is_mock,
            inference_ms=prediction.inference_ms,
            created_at=datetime.now(timezone.utc),
            raw_output=prediction.raw_output if self._expose_raw_output else None,
        )
        # Incident text and model output are intentionally not logged.
        logger.info(
            "Full triage completed",
            extra={
                "request_id": request_id,
                "provider": response.provider,
                "adapter": response.adapter,
                "severity": final_severity,
                "severity_source": source,
                "category": analysis.category,
                "uncertain": response.uncertain,
                "inference_ms": response.inference_ms,
            },
        )
        return response

    def triage(self, request: TriageRequest, *, request_id: str) -> TriageResponse:
        incident = _request_to_incident(request)
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
