"""VLLMSeverityProvider against a fake vLLM HTTP server (httpx.MockTransport)."""

from __future__ import annotations

import json

import httpx
import pytest

from app.services.errors import InferenceFailedError, InvalidModelOutputError, ProviderUnavailableError
from app.services.providers.base import IncidentInput
from app.services.providers.gemma_prompt import SEVERITY_INSTRUCTION
from app.services.providers.vllm_provider import VLLMSeverityProvider

INCIDENT = IncidentInput(title="t", description="d", affected_service="s", affected_users=3, business_impact="b")


class FakeVLLM:
    def __init__(self, content: str = '{"severity":"P2"}', models=("gemma3-270m-severity",),
                 chat_status: int = 200, down: bool = False):
        self.content, self.models, self.chat_status, self.down = content, models, chat_status, down
        self.requests: list[dict] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("connection refused", request=request)
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": m} for m in self.models]})
        if request.url.path == "/v1/chat/completions":
            self.requests.append(json.loads(request.content))
            if self.chat_status != 200:
                return httpx.Response(self.chat_status, text="boom")
            return httpx.Response(200, json={"choices": [{"message": {"content": self.content}}]})
        return httpx.Response(404)


def make(fake: FakeVLLM, **kw) -> VLLMSeverityProvider:
    p = VLLMSeverityProvider(base_url="http://vllm:8001", served_model="gemma3-270m-severity",
                             base_model_id="google/gemma-3-270m-it", adapter_label="gemma3-270m-severity",
                             transport=httpx.MockTransport(fake), status_ttl_s=0, **kw)
    p.start()
    return p


def test_ready_when_model_is_served():
    status = make(FakeVLLM()).status()
    assert status.ready and status.model_loaded
    assert status.device == "vllm-server"


def test_unavailable_when_server_down_or_model_missing():
    assert make(FakeVLLM(down=True)).status().state.value == "unavailable"
    missing = make(FakeVLLM(models=("other",))).status()
    assert missing.state.value == "unavailable" and "VLLM_MODEL" in (missing.detail or "")


def test_ticket_text_uses_training_format_via_chat_endpoint():
    fake = FakeVLLM('{"severity":"P2"}')
    pred = make(fake).predict_severity_from_text("  Ticket narrative.  ")
    assert pred.severity == "P2"
    (body,) = fake.requests
    assert body["model"] == "gemma3-270m-severity"
    assert body["temperature"] == 0.0 and body["max_tokens"] == 32
    # Same single user turn as training: instruction + blank line + text (no title, no label).
    assert body["messages"] == [{"role": "user", "content": SEVERITY_INSTRUCTION + "\n\nTicket narrative."}]
    assert "response_format" not in body


def test_structured_output_constrains_to_the_four_labels():
    fake = FakeVLLM()
    make(fake, structured_output=True).predict_severity(INCIDENT)
    schema = fake.requests[0]["response_format"]["json_schema"]["schema"]
    assert schema["properties"]["severity"]["enum"] == ["P1", "P2", "P3", "P4"]
    assert schema["additionalProperties"] is False


@pytest.mark.parametrize("content", ['{"severity":"P9"}', "P2", '{"severity":"P2","why":"x"}', ""])
def test_invalid_output_is_rejected_by_the_shared_parser(content):
    with pytest.raises(InvalidModelOutputError):
        make(FakeVLLM(content)).predict_severity(INCIDENT)


def test_server_error_is_inference_failure():
    with pytest.raises(InferenceFailedError):
        make(FakeVLLM(chat_status=500)).predict_severity(INCIDENT)


def test_server_down_is_unavailable_never_a_fallback():
    with pytest.raises(ProviderUnavailableError):
        make(FakeVLLM(down=True)).predict_severity(INCIDENT)


def test_model_id_identifies_vllm_serving():
    assert make(FakeVLLM()).model_id == "google/gemma-3-270m-it + LoRA:gemma3-270m-severity (vLLM)"


def test_api_end_to_end_with_vllm_provider(make_client, valid_payload):
    with make_client(make(FakeVLLM('{"severity":"P1"}'))) as client:
        health = client.get("/health").json()["inference"]
        res = client.post("/api/v1/triage", json=valid_payload)
    assert health["provider"] == "vllm" and health["ready"] and not health["is_mock"]
    assert res.status_code == 200
    body = res.json()
    assert body["severity"] == "P1" and body["provider"] == "vllm" and body["is_mock"] is False
