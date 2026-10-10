"""Failure handling. A real-provider failure must surface as an error, never as a
(mock or otherwise) prediction."""

from __future__ import annotations

import threading
from pathlib import Path

import pytest

from app.services.errors import InferenceFailedError, InvalidModelOutputError
from app.services.providers.base import (
    IncidentInput,
    InferenceProvider,
    ProviderState,
    ProviderStatus,
)
from app.services.providers.gemma_provider import GemmaSeverityProvider


class FakeGemmaProvider(GemmaSeverityProvider):
    """Real GemmaSeverityProvider lifecycle/validation with the weights replaced.

    `_load` and `_generate` are the only overridden methods, so readiness checks,
    timing, error wrapping and output validation are the production code paths.
    """

    def __init__(self, *, raw_output: str | None = None, generate_error: Exception | None = None,
                 load_error: Exception | None = None, load_gate: threading.Event | None = None):
        super().__init__(base_model_id="google/gemma-3-270m-it", adapter_path=Path("fake/best_adapter"))
        self.raw_output = raw_output
        self.generate_error = generate_error
        self.load_error = load_error
        self.load_gate = load_gate
        self.generate_calls = 0

    def _load(self) -> None:
        if self.load_gate is not None:
            self.load_gate.wait(10)
        if self.load_error is not None:
            raise self.load_error
        self._device = "cpu"
        self._model = object()
        self._tokenizer = object()

    def _generate(self, messages):  # type: ignore[override]
        self.generate_calls += 1
        if self.generate_error is not None:
            raise self.generate_error
        return self.raw_output


def _assert_no_prediction(res) -> None:
    body = res.json()
    assert "severity" not in body
    assert "mock" not in res.text.lower()
    assert body["error"]["request_id"]


def test_gemma_valid_output_is_returned_as_gemma(make_client, valid_payload):
    provider = FakeGemmaProvider(raw_output='{"severity":"P2"}')
    with make_client(provider) as client:
        res = client.post("/api/v1/triage", json=valid_payload)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["severity"] == "P2"
    assert body["provider"] == "gemma"
    assert body["is_mock"] is False
    assert body["model_id"] == "google/gemma-3-270m-it + LoRA:fake"


@pytest.mark.parametrize(
    "raw",
    ['{"severity":"P7"}', "not json at all", '{"severity":"P1","reason":"x"}', ""],
)
def test_gemma_invalid_output_is_502_without_prediction(make_client, valid_payload, raw):
    provider = FakeGemmaProvider(raw_output=raw)
    with make_client(provider) as client:
        res = client.post("/api/v1/triage", json=valid_payload)
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "invalid_model_output"
    _assert_no_prediction(res)


def test_gemma_generation_exception_is_500_without_prediction(make_client, valid_payload):
    provider = FakeGemmaProvider(generate_error=RuntimeError("MPS out of memory at /secret/path"))
    with make_client(provider) as client:
        res = client.post("/api/v1/triage", json=valid_payload)
    assert res.status_code == 500
    assert res.json()["error"]["code"] == "inference_failed"
    assert "/secret/path" not in res.text  # internals stay in server logs
    _assert_no_prediction(res)


def test_gemma_load_failure_is_503_and_never_calls_generate(make_client, valid_payload):
    provider = FakeGemmaProvider(load_error=OSError("weights corrupt at /secret/path"),
                                 raw_output='{"severity":"P1"}')
    with make_client(provider) as client:
        health = client.get("/health").json()["inference"]
        res = client.post("/api/v1/triage", json=valid_payload)
    assert health["state"] == "unavailable"
    assert health["ready"] is False and health["model_loaded"] is False
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "provider_unavailable"
    assert "/secret/path" not in res.text
    assert provider.generate_calls == 0
    _assert_no_prediction(res)


def test_gemma_while_loading_is_503_not_ready(make_client, valid_payload):
    gate = threading.Event()
    provider = FakeGemmaProvider(raw_output='{"severity":"P1"}', load_gate=gate)
    with make_client(provider, wait_for_load=False) as client:
        health = client.get("/health").json()["inference"]
        res = client.post("/api/v1/triage", json=valid_payload)
        calls_while_loading = provider.generate_calls
        gate.set()
        provider.wait_until_settled(10)
        after = client.post("/api/v1/triage", json=valid_payload)
    assert health["state"] == "loading"
    assert health["ready"] is False and health["model_loaded"] is False
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "provider_not_ready"
    assert calls_while_loading == 0
    assert after.status_code == 200
    assert provider.generate_calls == 1
    assert after.json()["provider"] == "gemma"


def test_unexpected_provider_exception_is_wrapped():
    class Exploding(InferenceProvider):
        name = "exploding"
        is_mock = False

        @property
        def model_id(self) -> str:
            return "exploding-1"

        def status(self) -> ProviderStatus:
            return ProviderStatus(state=ProviderState.READY, model_loaded=True)

        def _infer_raw(self, incident: IncidentInput) -> str:
            raise ValueError("boom")

    incident = IncidentInput(title="t", description="d", affected_service="s",
                             affected_users=1, business_impact="b")
    with pytest.raises(InferenceFailedError):
        Exploding().predict_severity(incident)


def test_invalid_output_error_is_not_swallowed_by_base():
    provider = FakeGemmaProvider(raw_output='{"severity":"High"}')
    provider.start()
    provider.wait_until_settled(5)
    incident = IncidentInput(title="t", description="d", affected_service="s",
                             affected_users=1, business_impact="b")
    with pytest.raises(InvalidModelOutputError):
        provider.predict_severity(incident)
