"""Environment-driven application configuration, validated at startup."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderName = Literal["mock", "gemma", "vllm"]
TriagePromptFormat = Literal["v3", "incident_lora"]
DevicePreference = Literal["auto", "cpu", "mps", "cuda"]

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """All runtime configuration. Invalid values abort startup with a clear error."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        # Allow a field literally named "model_id" (pydantic reserves "model_").
        protected_namespaces=(),
    )

    inference_provider: ProviderName = "mock"
    # Public identifier of the base model (shown in the API/UI).
    model_id: str = Field(default="google/gemma-3-270m-it", min_length=1, max_length=200)
    # Local directory holding the base model weights. When set, the base model is
    # loaded from here offline (no Hugging Face download). Empty -> load MODEL_ID
    # from the Hugging Face hub/cache. Relative paths resolve against backend/.
    base_model_path: str = ""
    adapter_path: str = Field(
        default="outputs/gemma3-270m-severity-lora/best_adapter", min_length=1
    )
    # Directory that a relative ADAPTER_PATH is resolved against (normally the
    # training repository). Empty -> resolve against the current directory.
    adapter_base_dir: str = ""
    device: DevicePreference = "auto"
    max_new_tokens: int = Field(default=32, ge=1, le=256)
    frontend_origin: str = "http://localhost:3000"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    mock_latency_ms: int = Field(default=400, ge=0, le=10_000)
    history_size: int = Field(default=200, ge=1, le=5_000)
    # Full (five-field) incident triage: a second LoRA adapter attached to the same base
    # model. Empty -> full triage is disabled (severity-only triage still works).
    # Resolved like ADAPTER_PATH (against ADAPTER_BASE_DIR, else backend/).
    triage_adapter_path: str = ""
    # Prompt layout the triage adapter was trained with (see gemma_triage_prompt.py).
    triage_prompt_format: TriagePromptFormat = "v3"
    triage_max_new_tokens: int = Field(default=192, ge=16, le=1024)
    # Generation time limit for full triage; exceeding it returns inference_timeout.
    triage_timeout_s: float = Field(default=120.0, gt=0, le=600)
    # Also run the severity adapter and report whether it agrees with the triage severity.
    severity_cross_check: bool = True
    # Development only: include the raw generated text in triage responses and in
    # invalid_model_output errors.
    expose_raw_output: bool = False
    # JSONL ticket queue; relative paths resolve against the backend/ directory.
    tickets_path: str = Field(default="data/tickets.jsonl", min_length=1)
    # Manual-triage examples (held-out data); relative to backend/.
    examples_path: str = Field(default="data/examples.jsonl", min_length=1)

    # INFERENCE_PROVIDER=vllm: the model is served by a separate vLLM server.
    vllm_base_url: str = "http://127.0.0.1:8001"
    # Name the vLLM server serves the model under (LoRA module name or merged model name).
    vllm_model: str = Field(default="gemma3-270m-severity", min_length=1)
    vllm_timeout_s: float = Field(default=30.0, gt=0, le=600)
    # Constrain generation to {"severity": P1..P4} via vLLM structured outputs.
    vllm_structured_output: bool = False

    @field_validator("inference_provider", "device", "triage_prompt_format", mode="before")
    @classmethod
    def _lowercase(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("log_level", mode="before")
    @classmethod
    def _uppercase(cls, value: object) -> object:
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("frontend_origin")
    @classmethod
    def _validate_origins(cls, value: str) -> str:
        origins = [o.strip() for o in value.split(",") if o.strip()]
        if not origins:
            raise ValueError("FRONTEND_ORIGIN must contain at least one origin")
        for origin in origins:
            parsed = urlparse(origin)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                raise ValueError(f"Invalid FRONTEND_ORIGIN entry: {origin!r}")
            if parsed.path not in ("", "/"):
                raise ValueError(f"FRONTEND_ORIGIN must not include a path: {origin!r}")
        return ",".join(o.rstrip("/") for o in origins)

    @property
    def cors_origins(self) -> list[str]:
        return self.frontend_origin.split(",")

    @field_validator("vllm_base_url")
    @classmethod
    def _validate_vllm_url(cls, value: str) -> str:
        parsed = urlparse(value.strip())
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError(f"Invalid VLLM_BASE_URL: {value!r}")
        return value.strip().rstrip("/")

    @field_validator("model_id")
    @classmethod
    def _validate_model_id(cls, value: str) -> str:
        value = value.strip()
        if not value or any(c.isspace() for c in value):
            raise ValueError("MODEL_ID must be a non-empty identifier without whitespace")
        return value

    @property
    def resolved_tickets_path(self) -> Path:
        path = Path(self.tickets_path).expanduser()
        return (path if path.is_absolute() else BACKEND_DIR / path).resolve()

    @property
    def resolved_examples_path(self) -> Path:
        path = Path(self.examples_path).expanduser()
        return (path if path.is_absolute() else BACKEND_DIR / path).resolve()

    @property
    def resolved_base_model_path(self) -> Path | None:
        if not self.base_model_path.strip():
            return None
        path = Path(self.base_model_path.strip()).expanduser()
        return (path if path.is_absolute() else BACKEND_DIR / path).resolve()

    def _resolve_adapter(self, value: str) -> Path:
        path = Path(value).expanduser()
        if not path.is_absolute():
            base = self.adapter_base_dir.strip()
            path = (Path(base).expanduser() if base else BACKEND_DIR) / path
        return path.resolve()

    @property
    def resolved_adapter_path(self) -> Path:
        """Adapter path with ~ expanded.

        Relative paths resolve against ADAPTER_BASE_DIR if set, else backend/.
        """
        return self._resolve_adapter(self.adapter_path)

    @property
    def resolved_triage_adapter_path(self) -> Path | None:
        """Triage adapter path (same resolution rules), or None when not configured."""
        value = self.triage_adapter_path.strip()
        return self._resolve_adapter(value) if value else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
