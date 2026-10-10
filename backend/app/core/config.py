"""Environment-driven application configuration, validated at startup."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderName = Literal["mock", "gemma"]
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
    # JSONL ticket queue; relative paths resolve against the backend/ directory.
    tickets_path: str = Field(default="data/tickets.jsonl", min_length=1)

    @field_validator("inference_provider", "device", mode="before")
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
    def resolved_base_model_path(self) -> Path | None:
        if not self.base_model_path.strip():
            return None
        path = Path(self.base_model_path.strip()).expanduser()
        return (path if path.is_absolute() else BACKEND_DIR / path).resolve()

    @property
    def resolved_adapter_path(self) -> Path:
        """Adapter path with ~ expanded.

        Relative paths resolve against ADAPTER_BASE_DIR if set, else backend/.
        """
        path = Path(self.adapter_path).expanduser()
        if not path.is_absolute():
            base = self.adapter_base_dir.strip()
            path = (Path(base).expanduser() if base else BACKEND_DIR) / path
        return path.resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
