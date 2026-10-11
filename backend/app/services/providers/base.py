"""Inference-provider interface.

The triage service depends only on `InferenceProvider`. Concrete providers
(mock, Gemma, a future remote/GPU provider) implement `_infer_raw` and
`status`; readiness checks, timing, failure wrapping and output validation are
handled uniformly by `predict_severity` so every provider behaves the same way.

This module deliberately has no web-framework or ML-library imports.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING

from app.services.errors import (
    InferenceError,
    InferenceFailedError,
    ProviderNotReadyError,
    ProviderUnavailableError,
    TriageUnavailableError,
)
from app.services.severity_parser import Severity, parse_severity_output
from app.services.triage_parser import TriageAnalysis, parse_triage_output

if TYPE_CHECKING:
    from app.services.providers.gemma_triage_prompt import TriageProfile

logger = logging.getLogger(__name__)


class ProviderState(str, Enum):
    NOT_LOADED = "not_loaded"
    LOADING = "loading"
    READY = "ready"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class ProviderStatus:
    state: ProviderState
    model_loaded: bool
    device: str | None = None
    # Human-readable, safe for clients (no paths / stack traces).
    detail: str | None = None

    @property
    def ready(self) -> bool:
        return self.state is ProviderState.READY


@dataclass(frozen=True)
class IncidentInput:
    """Provider-facing incident representation (independent of the HTTP schema)."""

    title: str
    description: str
    affected_service: str
    affected_users: int
    business_impact: str
    affected_departments: tuple[str, ...] = field(default_factory=tuple)
    affected_sites: tuple[str, ...] = field(default_factory=tuple)
    workaround_available: bool | None = None
    diagnostic_evidence: str = ""
    #: Free-text scope statement; derived from the scope fields when empty.
    scope_check: str = ""
    additional_context: str = ""


@dataclass(frozen=True)
class SeverityPrediction:
    severity: Severity
    inference_ms: float


@dataclass(frozen=True)
class TriageCapability:
    """Whether full (five-field) triage can be served, and by which adapter."""

    available: bool
    #: Public adapter name (never a path). None when no triage adapter is configured.
    adapter: str | None = None
    #: Full public model id used for triage, e.g. "<base> + LoRA:<adapter>".
    model_id: str | None = None
    prompt_format: str | None = None
    detail: str | None = None


@dataclass(frozen=True)
class TriagePrediction:
    analysis: TriageAnalysis
    #: Exact generated text, before parsing.
    raw_output: str
    inference_ms: float
    model_id: str
    adapter: str | None
    prompt_format: str | None


class InferenceProvider(ABC):
    """Base class for all severity inference providers."""

    #: Short provider identifier exposed in the API (e.g. "mock", "gemma").
    name: str
    #: True only for synthetic providers. Drives MOCK labelling in the UI.
    is_mock: bool

    @property
    @abstractmethod
    def model_id(self) -> str:
        """Public model identifier (never a filesystem path)."""

    def start(self) -> None:
        """Begin initialisation. May return before loading completes."""

    def shutdown(self) -> None:
        """Release resources."""

    @abstractmethod
    def status(self) -> ProviderStatus:
        """Current, truthful readiness status."""

    def is_ready(self) -> bool:
        return self.status().ready

    @abstractmethod
    def _infer_raw(self, incident: IncidentInput) -> str:
        """Run inference on a structured incident and return the raw generated text."""

    def _infer_raw_text(self, incident_text: str) -> str:
        """Run inference on a free-text incident narrative (e.g. a queued ticket)."""
        raise InferenceFailedError(
            f"The '{self.name}' provider does not support free-text incidents."
        )

    def predict_severity(self, incident: IncidentInput) -> SeverityPrediction:
        return self._predict(lambda: self._infer_raw(incident))

    # ------------------------------------------------------------ full triage
    def triage_capability(self) -> TriageCapability:
        """Override in providers that can run the five-field triage adapter."""
        return TriageCapability(
            available=False, detail=f"The '{self.name}' provider does not support full incident triage."
        )

    def triage_profile(self) -> "TriageProfile | None":
        """Prompt/validation profile of the active triage adapter."""
        return None

    def _infer_raw_triage(self, incident: IncidentInput) -> str:
        raise TriageUnavailableError()

    def _infer_raw_triage_text(self, incident_text: str) -> str:
        raise TriageUnavailableError()

    def predict_triage(self, incident: IncidentInput) -> TriagePrediction:
        """Five-field triage. Raises TriageUnavailableError when no triage adapter is
        loaded, and InvalidModelOutputError when the output breaks the contract."""
        return self._triage(lambda: self._infer_raw_triage(incident))

    def predict_triage_from_text(self, incident_text: str) -> TriagePrediction:
        """Five-field triage of a free-text narrative (e.g. a queued ticket). Callers pass
        only the incident text, never labels."""
        return self._triage(lambda: self._infer_raw_triage_text(incident_text))

    def _triage(self, infer: Callable[[], str]) -> TriagePrediction:
        self._ensure_ready()
        capability = self.triage_capability()
        profile = self.triage_profile()
        if not capability.available or profile is None:
            raise TriageUnavailableError(
                TriageUnavailableError.public_message
                + (f" ({capability.detail})" if capability.detail else "")
            )
        raw, elapsed_ms = self._timed(infer)
        analysis = parse_triage_output(raw, profile)
        return TriagePrediction(
            analysis=analysis,
            raw_output=raw,
            inference_ms=elapsed_ms,
            model_id=capability.model_id or self.model_id,
            adapter=capability.adapter,
            prompt_format=capability.prompt_format,
        )

    def predict_severity_from_text(self, incident_text: str) -> SeverityPrediction:
        """Severity for a free-text narrative. Callers pass only the incident text —
        never labels or other evaluation data."""
        return self._predict(lambda: self._infer_raw_text(incident_text))

    def _predict(self, infer: Callable[[], str]) -> SeverityPrediction:
        self._ensure_ready()
        raw, elapsed_ms = self._timed(infer)
        # Raises InvalidModelOutputError; never coerced into a fake prediction.
        severity = parse_severity_output(raw)
        return SeverityPrediction(severity=severity, inference_ms=elapsed_ms)

    def _ensure_ready(self) -> None:
        status = self.status()
        if status.state is ProviderState.UNAVAILABLE:
            raise ProviderUnavailableError(
                f"The '{self.name}' inference provider is unavailable"
                + (f": {status.detail}" if status.detail else ".")
            )
        if status.state is not ProviderState.READY:
            raise ProviderNotReadyError(
                f"The '{self.name}' inference provider is {status.state.value.replace('_', ' ')}. "
                "Try again shortly."
            )

    def _timed(self, infer: Callable[[], str]) -> tuple[str, float]:
        started = time.perf_counter()
        try:
            raw = infer()
        except InferenceError:
            raise
        except Exception as exc:  # noqa: BLE001 - wrap anything unexpected
            logger.exception("Provider raised during inference", extra={"provider": self.name})
            raise InferenceFailedError(internal_detail=repr(exc)) from exc
        return raw, round((time.perf_counter() - started) * 1000.0, 2)
