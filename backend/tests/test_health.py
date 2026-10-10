from __future__ import annotations

from pathlib import Path

from app.services.providers.gemma_provider import GemmaSeverityProvider


def test_health_mock_reports_mock_and_no_model(mock_client):
    res = mock_client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    inference = body["inference"]
    assert inference["provider"] == "mock"
    assert inference["is_mock"] is True
    assert inference["ready"] is True
    # The mock has no model; it must never claim one is loaded.
    assert inference["model_loaded"] is False
    assert "gemma" not in inference["model_id"].lower()
    assert res.headers.get("X-Request-ID")


def test_health_gemma_missing_adapter_is_unavailable_not_ready(make_client, tmp_path: Path):
    missing = tmp_path / "no-such-adapter"
    provider = GemmaSeverityProvider(base_model_id="google/gemma-3-270m-it", adapter_path=missing)
    with make_client(provider) as client:
        res = client.get("/health")
    assert res.status_code == 200  # API itself is up...
    inference = res.json()["inference"]
    assert inference["provider"] == "gemma"
    assert inference["is_mock"] is False
    assert inference["state"] == "unavailable"  # ...but the model is not.
    assert inference["ready"] is False
    assert inference["model_loaded"] is False
    # No filesystem paths in public responses (model_id carries only the directory name).
    assert str(tmp_path) not in res.text


def test_health_gemma_before_start_is_not_loaded(tmp_path: Path):
    provider = GemmaSeverityProvider(base_model_id="google/gemma-3-270m-it", adapter_path=tmp_path)
    status = provider.status()
    assert status.state.value == "not_loaded"
    assert status.ready is False
    assert status.model_loaded is False


def test_unknown_route_uses_error_envelope(mock_client):
    res = mock_client.get("/does-not-exist")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"
