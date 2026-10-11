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
    TriageCapability,
)
from app.services.providers.gemma_triage_prompt import V3_PROFILE, TriageProfile
from app.services.severity_parser import Severity

MOCK_MODEL_ID = "mock-synthetic-rules-v1"
MOCK_TRIAGE_MODEL_ID = "mock-synthetic-triage-v1"

#: Including this marker in an incident title makes the mock provider raise an
#: inference failure, so the UI error/retry path can be exercised manually.
MOCK_FAILURE_MARKER = "[mock-fail]"
#: Including this marker in a title makes mock full triage return malformed JSON,
#: so the invalid-output path can be exercised manually.
MOCK_INVALID_MARKER = "[mock-invalid]"

# Keyword rules for the synthetic category (first match wins). NOT a classifier.
_CATEGORY_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("security", ("phish", "suspicious", "malware", "breach")),
    ("teams", ("teams",)),
    ("exchange", ("outlook", "mailbox", "exchange", "email")),
    ("sharepoint", ("sharepoint", "onedrive")),
    ("network", ("vpn", "dns", "proxy", "network", "wifi", "wi-fi")),
    ("conditional_access", ("conditional access",)),
    ("device_compliance", ("intune", "compliance", "enrol")),
    ("identity", ("mfa", "consent")),
    ("authentication", ("sign-in", "sign in", "login", "log in", "password", "locked")),
)


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


def synthetic_category(incident: IncidentInput) -> str:
    """Deterministic keyword rule (NOT a prediction model)."""
    return _category_from_text(f"{incident.title} {incident.description} {incident.affected_service}")


def _category_from_text(text: str) -> str:
    text = text.lower()
    for category, words in _CATEGORY_KEYWORDS:
        if any(w in text for w in words):
            return category
    return "endpoint"


def synthetic_triage(incident: IncidentInput) -> dict[str, object]:
    """Five-field synthetic result. Evidence quotes only what the user supplied;
    the single 'action' says plainly that no model produced it."""
    category = synthetic_category(incident)
    root_cause = next(rc for rc, info in V3_PROFILE.root_causes.items() if info.category == category)  # type: ignore[union-attr]
    evidence = [incident.business_impact.strip()]
    if incident.diagnostic_evidence.strip():
        evidence.append(incident.diagnostic_evidence.strip())
    return {
        "category": category,
        "severity": synthetic_severity(incident),
        "root_cause": root_cause,
        "evidence": evidence,
        "recommended_actions": [
            "[MOCK] Synthetic placeholder: no model produced recommendations. Review the incident manually."
        ],
    }


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

    def triage_capability(self) -> TriageCapability:
        return TriageCapability(
            available=True,
            adapter=None,
            model_id=MOCK_TRIAGE_MODEL_ID,
            prompt_format=None,
            detail="Mock provider: five-field results are synthetic keyword rules, not model output.",
        )

    def triage_profile(self) -> TriageProfile:
        # Validated against the v3 taxonomy so mock output exercises the same checks.
        return V3_PROFILE

    def _infer_raw_triage(self, incident: IncidentInput) -> str:
        if self._latency_s:
            time.sleep(self._latency_s)
        title = incident.title.lower()
        if MOCK_FAILURE_MARKER in title:
            raise InferenceFailedError("Simulated mock inference failure (title contains '[mock-fail]').")
        if MOCK_INVALID_MARKER in title:
            return '{"category": "network", "severity": "P2", "root_cause": '  # truncated on purpose
        return json.dumps(synthetic_triage(incident), separators=(",", ":"))

    def _infer_raw_triage_text(self, incident_text: str) -> str:
        if self._latency_s:
            time.sleep(self._latency_s)
        if MOCK_FAILURE_MARKER in incident_text.lower():
            raise InferenceFailedError("Simulated mock inference failure (text contains '[mock-fail]').")
        category = _category_from_text(incident_text)
        root_cause = next(rc for rc, info in V3_PROFILE.root_causes.items() if info.category == category)  # type: ignore[union-attr]
        first_sentence = incident_text.strip().split(". ")[0].rstrip(".") + "."
        return json.dumps(
            {
                "category": category,
                "severity": synthetic_severity_from_text(incident_text),
                "root_cause": root_cause,
                "evidence": [first_sentence],
                "recommended_actions": [
                    "[MOCK] Synthetic placeholder: no model produced recommendations. Review the incident manually."
                ],
            },
            separators=(",", ":"),
        )

    def _infer_raw_text(self, incident_text: str) -> str:
        if self._latency_s:
            time.sleep(self._latency_s)
        if MOCK_FAILURE_MARKER in incident_text.lower():
            raise InferenceFailedError("Simulated mock inference failure (text contains '[mock-fail]').")
        return json.dumps({"severity": synthetic_severity_from_text(incident_text)}, separators=(",", ":"))
