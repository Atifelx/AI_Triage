"""Build the configured inference provider. No fallback between providers."""

from __future__ import annotations

from app.core.config import Settings
from app.services.providers.base import InferenceProvider
from app.services.providers.gemma_provider import GemmaSeverityProvider
from app.services.providers.mock_provider import MockInferenceProvider


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
        )
    # Unreachable: Settings validates the value. Kept as a hard failure, never a fallback.
    raise ValueError(f"Unknown INFERENCE_PROVIDER: {settings.inference_provider!r}")
