"""Build the configured inference provider. No fallback between providers."""

from __future__ import annotations

from app.core.config import Settings
from app.services.providers.base import InferenceProvider
from app.services.providers.gemma_provider import GemmaSeverityProvider, adapter_label
from app.services.providers.gemma_triage_prompt import get_profile
from app.services.providers.mock_provider import MockInferenceProvider
from app.services.providers.vllm_provider import VLLMSeverityProvider


def build_provider(settings: Settings) -> InferenceProvider:
    if settings.inference_provider == "mock":
        return MockInferenceProvider(latency_ms=settings.mock_latency_ms)
    if settings.inference_provider == "gemma":
        return GemmaSeverityProvider(
            base_model_id=settings.model_id,
            base_model_path=settings.resolved_base_model_path,
            adapter_path=settings.resolved_adapter_path,
            device=settings.device,
            max_new_tokens=settings.max_new_tokens,
            triage_adapter_path=settings.resolved_triage_adapter_path,
            triage_profile=get_profile(settings.triage_prompt_format),
            triage_max_new_tokens=settings.triage_max_new_tokens,
            triage_timeout_s=settings.triage_timeout_s,
        )
    if settings.inference_provider == "vllm":
        return VLLMSeverityProvider(
            base_url=settings.vllm_base_url,
            served_model=settings.vllm_model,
            base_model_id=settings.model_id,
            adapter_label=adapter_label(settings.resolved_adapter_path),
            max_new_tokens=settings.max_new_tokens,
            timeout_s=settings.vllm_timeout_s,
            structured_output=settings.vllm_structured_output,
        )
    # Unreachable: Settings validates the value. Kept as a hard failure, never a fallback.
    raise ValueError(f"Unknown INFERENCE_PROVIDER: {settings.inference_provider!r}")
