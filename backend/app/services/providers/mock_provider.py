"""MockInferenceProvider — synthetic results for integration testing ONLY.

This provider does not load or call any model. It derives a severity from the
structured scope fields with a fixed, transparent rule so that the full
frontend -> API -> service flow can be exercised deterministically.

It is not a model, it has not been evaluated, it never claims to be Gemma, and
it does not read any dataset or test-set labels.
"""

from __future__ import annotations

import hashlib
import json
import time

from app.services.errors import InferenceFailedError
from app.services.providers.base import (
    IncidentInput,
    InferenceProvider,
    ProviderState,
    ProviderStatus,
)
from app.services.severity_parser import Severity

MOCK_MODEL_ID = "mock-synthetic-rules-v1"

#: Including this marker in an incident title makes the mock provider raise an
#: inference failure, so the UI error/retry path can be exercised manually.
MOCK_FAILURE_MARKER = "[mock-fail]"


def synthetic_severity(incident: IncidentInput) -> Severity:
    """Deterministic synthetic rule (NOT a prediction model)."""
    departments = len(incident.affected_departments)
    sites = len(incident.affected_sites)
    if departments >= 2 and sites >= 2 and incident.workaround_available is not True:
        return "P1"
    if incident.affected_users > 1:
        return "P2"
    if incident.affected_users == 1:
        return "P3"
    return "P4"


def synthetic_severity_from_text(text: str) -> Severity:
    """Deterministic pseudo-random label from a hash of the text (NOT a prediction).

    Deliberately content-blind so mock results can never be mistaken for a working
    classifier: on a balanced queue it agrees with the reference ~25% of the time.
    """
    digest = hashlib.sha256(text.strip().encode("utf-8")).digest()
    return ("P1", "P2", "P3", "P4")[digest[0] % 4]  # type: ignore[return-value]


class MockInferenceProvider(InferenceProvider):
    name = "mock"
    is_mock = True

    def __init__(self, latency_ms: int = 0) -> None:
        self._latency_s = max(latency_ms, 0) / 1000.0

    @property
    def model_id(self) -> str:
        return MOCK_MODEL_ID

    def status(self) -> ProviderStatus:
        return ProviderStatus(
            state=ProviderState.READY,
            model_loaded=False,  # there is no model
            device=None,
            detail="Mock provider active: results are synthetic and not produced by any model.",
        )

    def _infer_raw(self, incident: IncidentInput) -> str:
        if self._latency_s:
            time.sleep(self._latency_s)
        if MOCK_FAILURE_MARKER in incident.title.lower():
            raise InferenceFailedError(
                "Simulated mock inference failure (title contains '[mock-fail]')."
            )
        return json.dumps({"severity": synthetic_severity(incident)}, separators=(",", ":"))

    def _infer_raw_text(self, incident_text: str) -> str:
        if self._latency_s:
            time.sleep(self._latency_s)
        if MOCK_FAILURE_MARKER in incident_text.lower():
            raise InferenceFailedError("Simulated mock inference failure (text contains '[mock-fail]').")
        return json.dumps({"severity": synthetic_severity_from_text(incident_text)}, separators=(",", ":"))
