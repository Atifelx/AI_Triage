from __future__ import annotations

import os
import sys
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

# Tests must never pick up a developer's backend/.env (which may select gemma).
os.environ["INFERENCE_PROVIDER"] = "mock"
os.environ["MOCK_LATENCY_MS"] = "0"

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services.providers.base import InferenceProvider  # noqa: E402
from app.services.providers.mock_provider import MockInferenceProvider  # noqa: E402


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {"inference_provider": "mock", "mock_latency_ms": 0}
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


@contextmanager
def client_for(
    provider: InferenceProvider, *, wait_for_load: bool = True, **settings: Any
) -> Iterator[TestClient]:
    app = create_app(settings=make_settings(**settings), provider=provider)
    # raise_server_exceptions=False so unhandled errors surface as HTTP 500s.
    with TestClient(app, raise_server_exceptions=False) as client:
        wait = getattr(provider, "wait_until_settled", None)
        if wait_for_load and wait:
            wait(10)
        yield client


@pytest.fixture
def make_client() -> Callable[[InferenceProvider], Any]:
    return client_for


@pytest.fixture
def mock_client() -> Iterator[TestClient]:
    with client_for(MockInferenceProvider(latency_ms=0)) as client:
        yield client


@pytest.fixture
def valid_payload() -> dict[str, Any]:
    return {
        "title": "Microsoft 365 sign-in failures",
        "description": "Multiple employees cannot sign in.",
        "affected_service": "Microsoft 365",
        "affected_users": 45,
        "affected_departments": ["Finance", "Operations"],
        "affected_sites": ["Mumbai", "Pune"],
        "business_impact": "Employees cannot access business applications.",
        "workaround_available": False,
        "diagnostic_evidence": "Authentication failures reported by affected users.",
    }
