from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TriageHealth(BaseModel):
    model_config = {"protected_namespaces": ()}

    available: bool = Field(description="True only when the five-field triage adapter is loaded")
    adapter: str | None = None
    model_id: str | None = None
    prompt_format: str | None = None
    detail: str | None = None


class InferenceHealth(BaseModel):
    model_config = {"protected_namespaces": ()}

    provider: str = Field(description="Configured provider: mock or gemma")
    model_id: str
    is_mock: bool
    state: Literal["not_loaded", "loading", "ready", "unavailable"]
    ready: bool = Field(description="True only when the provider can serve inference now")
    model_loaded: bool = Field(description="True only when real model weights are in memory")
    device: str | None = None
    detail: str | None = None
    triage: TriageHealth | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"] = Field(description="API process status (independent of model)")
    api_version: str
    inference: InferenceHealth
    timestamp: datetime
