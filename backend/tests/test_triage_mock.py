"""End-to-end API tests with the mock provider (integration path, not model quality)."""

from __future__ import annotations

from datetime import datetime

from app.services.providers.base import IncidentInput
from app.services.providers.mock_provider import MOCK_MODEL_ID, synthetic_severity

EXPECTED_KEYS = {
    "request_id",
    "incident_title",
    "severity",
    "human_review_required",
    "provider",
    "model_id",
    "is_mock",
    "inference_ms",
    "created_at",
}


def test_triage_returns_labelled_mock_result(mock_client, valid_payload):
    res = mock_client.post("/api/v1/triage", json=valid_payload)
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body) == EXPECTED_KEYS  # no confidence / root cause / explanation
    assert body["severity"] in {"P1", "P2", "P3", "P4"}
    assert body["provider"] == "mock"
    assert body["is_mock"] is True
    assert body["model_id"] == MOCK_MODEL_ID
    assert body["human_review_required"] is True
    assert body["incident_title"] == valid_payload["title"]
    assert body["inference_ms"] >= 0
    datetime.fromisoformat(body["created_at"])
    assert body["request_id"] == res.headers["X-Request-ID"]


def test_mock_is_deterministic(mock_client, valid_payload):
    first = mock_client.post("/api/v1/triage", json=valid_payload).json()
    second = mock_client.post("/api/v1/triage", json=valid_payload).json()
    assert first["severity"] == second["severity"]
    assert first["request_id"] != second["request_id"]


def test_mock_rule_covers_all_labels():
    base = dict(title="t", description="d", affected_service="s", business_impact="b")
    assert synthetic_severity(
        IncidentInput(**base, affected_users=45, affected_departments=("A", "B"),
                      affected_sites=("X", "Y"), workaround_available=False)
    ) == "P1"
    assert synthetic_severity(IncidentInput(**base, affected_users=10, affected_departments=("A",))) == "P2"
    assert synthetic_severity(IncidentInput(**base, affected_users=1)) == "P3"
    assert synthetic_severity(IncidentInput(**base, affected_users=0)) == "P4"


def test_get_result_by_id(mock_client, valid_payload):
    created = mock_client.post("/api/v1/triage", json=valid_payload).json()
    res = mock_client.get(f"/api/v1/triage/{created['request_id']}")
    assert res.status_code == 200
    assert res.json() == created


def test_get_unknown_result_is_404(mock_client):
    res = mock_client.get("/api/v1/triage/abc123")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


def test_mock_failure_marker_returns_controlled_error(mock_client, valid_payload):
    valid_payload["title"] = "Test [mock-fail] path"
    res = mock_client.post("/api/v1/triage", json=valid_payload)
    assert res.status_code == 500
    err = res.json()["error"]
    assert err["code"] == "inference_failed"
    assert err["request_id"]
    assert "severity" not in res.json()


def test_cors_allows_configured_frontend_origin(mock_client, valid_payload):
    res = mock_client.options(
        "/api/v1/triage",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == "http://localhost:3000"
