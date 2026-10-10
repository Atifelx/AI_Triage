from __future__ import annotations

import pytest


def _fields(res) -> dict[str, str]:
    return {d["field"]: d["message"] for d in res.json()["error"].get("details", [])}


def test_missing_required_fields(mock_client):
    res = mock_client.post("/api/v1/triage", json={})
    assert res.status_code == 422
    body = res.json()["error"]
    assert body["code"] == "validation_error"
    fields = _fields(res)
    for name in ("title", "description", "affected_service", "affected_users", "business_impact"):
        assert fields[name] == "This field is required."


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("title", "ab"),
        ("title", "x" * 201),
        ("description", "short"),
        ("description", "x" * 4001),
        ("affected_service", "x"),
        ("business_impact", "x" * 2001),
        ("diagnostic_evidence", "x" * 4001),
        ("affected_users", -1),
        ("affected_users", 1_000_001),
        ("affected_users", "45"),  # strict: no string coercion
        ("affected_users", 4.5),
        ("affected_departments", ["Dept"] * 2 + [f"D{i}" for i in range(20)]),
        ("affected_departments", [f"D{i}" for i in range(21)]),
        ("affected_departments", ["x" * 81]),
        ("affected_departments", [""]),
        ("affected_sites", ["Pune", "pune"]),  # case-insensitive duplicate
        ("workaround_available", "yes"),  # strict bool / null
    ],
)
def test_invalid_field_values(mock_client, valid_payload, field, value):
    valid_payload[field] = value
    res = mock_client.post("/api/v1/triage", json=valid_payload)
    assert res.status_code == 422, res.text
    assert any(f.startswith(field) for f in _fields(res))


def test_whitespace_only_title_is_rejected(mock_client, valid_payload):
    valid_payload["title"] = "     "
    res = mock_client.post("/api/v1/triage", json=valid_payload)
    assert res.status_code == 422
    assert "title" in _fields(res)


def test_unknown_field_is_rejected(mock_client, valid_payload):
    valid_payload["confidence"] = 0.99
    res = mock_client.post("/api/v1/triage", json=valid_payload)
    assert res.status_code == 422
    assert _fields(res)["confidence"] == "Unknown field."


def test_invalid_json_body(mock_client):
    res = mock_client.post(
        "/api/v1/triage",
        content=b'{"title": "broken",',
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_json"


def test_optional_fields_may_be_omitted(mock_client, valid_payload):
    for key in ("affected_departments", "affected_sites", "workaround_available", "diagnostic_evidence"):
        valid_payload.pop(key)
    res = mock_client.post("/api/v1/triage", json=valid_payload)
    assert res.status_code == 200, res.text


def test_workaround_unknown_is_null(mock_client, valid_payload):
    valid_payload["workaround_available"] = None
    res = mock_client.post("/api/v1/triage", json=valid_payload)
    assert res.status_code == 200


def test_get_triage_rejects_malformed_id(mock_client):
    res = mock_client.get("/api/v1/triage/not%20valid!")
    assert res.status_code == 422
