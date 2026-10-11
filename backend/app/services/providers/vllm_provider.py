"""VLLMSeverityProvider — the same fine-tuned model, served by a vLLM server.

The API process does no model work here: it sends chat requests to a vLLM
server (OpenAI-compatible API) that hosts Gemma 3 270M + the severity adapter,
either as a LoRA module or as a merged checkpoint. Prompt construction and output
validation are shared with GemmaSeverityProvider, so both paths see the identical
instruction text and are judged by the identical strict parser.

* Uses /v1/chat/completions, which applies the model's chat template and does
  NOT add a second <bos> (the training-format requirement; see gemma_prompt.py).
* Greedy decoding (temperature 0), max_tokens = MAX_NEW_TOKENS.
* Optional structured output constrains generation to {"severity": P1..P4}.
* Readiness is probed via GET /v1/models; an unreachable server or a missing
  model is reported as unavailable. Never falls back to another provider.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

import httpx

from app.services.errors import InferenceFailedError, ProviderUnavailableError
from app.services.providers.base import (
    IncidentInput,
    InferenceProvider,
    ProviderState,
    ProviderStatus,
)
from app.services.providers.gemma_prompt import build_chat_messages, build_text_chat_messages
from app.services.severity_parser import SEVERITIES

logger = logging.getLogger(__name__)

SEVERITY_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"severity": {"type": "string", "enum": list(SEVERITIES)}},
    "required": ["severity"],
    "additionalProperties": False,
}


class VLLMSeverityProvider(InferenceProvider):
    name = "vllm"
    is_mock = False

    def __init__(
        self,
        *,
        base_url: str,
        served_model: str,
        base_model_id: str,
        adapter_label: str,
        max_new_tokens: int = 32,
        timeout_s: float = 30.0,
        structured_output: bool = False,
        status_ttl_s: float = 2.0,
        transport: httpx.BaseTransport | None = None,  # injectable for tests
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._served_model = served_model
        self._model_id = f"{base_model_id} + LoRA:{adapter_label} (vLLM)"
        self._max_new_tokens = max_new_tokens
        self._timeout_s = timeout_s
        self._structured_output = structured_output
        self._status_ttl_s = status_ttl_s
        self._transport = transport
        self._client: httpx.Client | None = None
        self._lock = threading.Lock()
        self._cached: tuple[float, ProviderStatus] | None = None

    # ------------------------------------------------------------------ identity
    @property
    def model_id(self) -> str:
        return self._model_id

    # ------------------------------------------------------------------ lifecycle
    def _http(self) -> httpx.Client:
        with self._lock:
            if self._client is None:
                self._client = httpx.Client(
                    base_url=self._base_url, timeout=self._timeout_s, transport=self._transport
                )
            return self._client

    def start(self) -> None:
        self._http()

    def shutdown(self) -> None:
        with self._lock:
            if self._client is not None:
                self._client.close()
                self._client = None

    def status(self) -> ProviderStatus:
        now = time.monotonic()
        cached = self._cached
        if cached and now - cached[0] < self._status_ttl_s:
            return cached[1]
        status = self._probe()
        self._cached = (now, status)
        return status

    def _probe(self) -> ProviderStatus:
        try:
            res = self._http().get("/v1/models", timeout=min(self._timeout_s, 3.0))
            res.raise_for_status()
            served = {m.get("id") for m in res.json().get("data", [])}
        except (httpx.HTTPError, ValueError, AttributeError) as exc:
            logger.debug("vLLM probe failed", extra={"error": repr(exc)})
            return ProviderStatus(
                state=ProviderState.UNAVAILABLE,
                model_loaded=False,
                device="vllm-server",
                detail="vLLM server is not reachable. Check that it is running and VLLM_BASE_URL.",
            )
        if self._served_model not in served:
            return ProviderStatus(
                state=ProviderState.UNAVAILABLE,
                model_loaded=False,
                device="vllm-server",
                detail=f"vLLM server is up but does not serve '{self._served_model}'. Check VLLM_MODEL.",
            )
        return ProviderStatus(
            state=ProviderState.READY, model_loaded=True, device="vllm-server", detail="Served by vLLM."
        )

    # ------------------------------------------------------------------ inference
    def _infer_raw(self, incident: IncidentInput) -> str:
        return self._chat(build_chat_messages(incident))

    def _infer_raw_text(self, incident_text: str) -> str:
        return self._chat(build_text_chat_messages(incident_text))

    def _chat(self, messages: list[dict[str, str]]) -> str:
        body: dict[str, Any] = {
            "model": self._served_model,
            "messages": messages,
            "temperature": 0.0,
            "max_tokens": self._max_new_tokens,
        }
        if self._structured_output:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "severity", "schema": SEVERITY_JSON_SCHEMA, "strict": True},
            }
        try:
            res = self._http().post("/v1/chat/completions", json=body)
        except httpx.ConnectError as exc:
            self._cached = None
            raise ProviderUnavailableError(
                "The vLLM server is not reachable.", internal_detail=repr(exc)
            ) from exc
        except httpx.TimeoutException as exc:
            raise InferenceFailedError("The vLLM server timed out.", internal_detail=repr(exc)) from exc
        except httpx.HTTPError as exc:
            raise InferenceFailedError(internal_detail=repr(exc)) from exc

        if res.status_code != 200:
            raise InferenceFailedError(internal_detail=f"vLLM HTTP {res.status_code}: {res.text[:300]}")
        try:
            content = res.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise InferenceFailedError(internal_detail=f"unexpected vLLM response: {res.text[:300]}") from exc
        if not isinstance(content, str):
            raise InferenceFailedError(internal_detail=f"non-text vLLM content: {content!r}")
        return content.strip()
