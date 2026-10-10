from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import BACKEND_DIR, Settings
from app.services.providers.factory import build_provider
from app.services.providers.gemma_provider import GemmaSeverityProvider
from app.services.providers.mock_provider import MockInferenceProvider


def make_settings(**values) -> Settings:
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def test_defaults_select_mock():
    settings = make_settings()
    assert settings.inference_provider == "mock"
    assert isinstance(build_provider(settings), MockInferenceProvider)


def test_gemma_provider_is_built_but_not_loaded():
    provider = build_provider(make_settings(inference_provider="GEMMA"))
    assert isinstance(provider, GemmaSeverityProvider)
    assert provider.status().state.value == "not_loaded"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("inference_provider", "openai"),
        ("device", "tpu"),
        ("max_new_tokens", 0),
        ("max_new_tokens", 10_000),
        ("frontend_origin", "localhost:3000"),
        ("frontend_origin", "http://localhost:3000/app"),
        ("frontend_origin", " , "),
        ("model_id", "google/gemma 3"),
        ("log_level", "VERBOSE"),
    ],
)
def test_invalid_settings_fail_fast(field, value):
    with pytest.raises(ValidationError):
        make_settings(**{field: value})


def test_multiple_frontend_origins():
    settings = make_settings(frontend_origin="http://localhost:3000, https://triage.example.com/")
    assert settings.cors_origins == ["http://localhost:3000", "https://triage.example.com"]


def test_relative_adapter_path_resolves_against_base_dir(tmp_path: Path):
    settings = make_settings(
        adapter_path="outputs/gemma3-270m-severity-lora/best_adapter",
        adapter_base_dir=str(tmp_path),
    )
    assert settings.resolved_adapter_path == (
        tmp_path / "outputs/gemma3-270m-severity-lora/best_adapter"
    ).resolve()


def test_absolute_adapter_path_ignores_base_dir(tmp_path: Path):
    absolute = tmp_path / "adapter"
    settings = make_settings(adapter_path=str(absolute), adapter_base_dir="/somewhere/else")
    assert settings.resolved_adapter_path == absolute.resolve()


def test_relative_paths_resolve_against_backend_dir_not_cwd(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)  # starting the API from elsewhere must not change model paths
    settings = make_settings(
        adapter_path="models/gemma3-270m-severity/adapter",
        base_model_path="models/gemma3-270m-severity/base",
    )
    assert settings.resolved_adapter_path == BACKEND_DIR / "models/gemma3-270m-severity/adapter"
    assert settings.resolved_base_model_path == BACKEND_DIR / "models/gemma3-270m-severity/base"


def test_empty_base_model_path_means_hub_model_id():
    assert make_settings().resolved_base_model_path is None


def test_absolute_base_model_path(tmp_path: Path):
    assert make_settings(base_model_path=str(tmp_path)).resolved_base_model_path == tmp_path.resolve()
