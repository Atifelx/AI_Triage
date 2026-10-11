"""Post-review routing and sandbox integrations."""

from __future__ import annotations

import pytest

from app.services.integrations.routing import SERVICE_DESK, owner_for, plan_route


def ticket(severity: str = "P2", category: str = "authentication", **overrides) -> dict:
    body = {
        "review_ticket_id": "REV-1042",
        "incident": {
            "title": "Microsoft 365 sign-in failures",
            "description": "Multiple employees cannot sign in.",
            "affected_service": "Microsoft 365",
            "affected_users": 45,
            "affected_departments": ["Finance", "Operations"],
            "affected_sites": ["Mumbai", "Pune"],
            "business_impact": "Employees cannot access business applications.",
            "workaround_available": False,
            "diagnostic_evidence": "Authentication failures reported by affected users.",
        },
        "incident_text": "Microsoft 365 sign-in failures. Multiple employees cannot sign in.",
        "analysis": {
            "category": category,
            "severity": "P2",
            "root_cause": "invalid_credentials",
            "evidence": ["Authentication failures reported by affected users."],
            "recommended_actions": ["Verify identity through the existing process."],
        },
        "root_cause_label": "Invalid credentials or stale cached password",
        "approved_severity": severity,
        "reviewer": "Priya Raman",
        "review_notes": "",
        "model_id": "google/gemma-3-270m-it + LoRA:gemma3-270m-triage-v3",
    }
    body.update(overrides)
    return body


def test_owner_by_category():
    assert owner_for("authentication").key == "iam"
    assert owner_for("network").key == "netops"
    assert owner_for("security").key == "soc"
    assert owner_for("unknown") is SERVICE_DESK


@pytest.mark.parametrize(
    "severity, connectors",
    [
        ("P1", ("servicenow", "jira", "slack", "teams", "crm")),
        ("P2", ("servicenow", "jira", "slack", "crm")),
        ("P3", ("servicenow", "jira")),
        ("P4", ("servicenow",)),
    ],
)
def test_fanout_by_approved_severity(severity, connectors):
    assert plan_route("network", severity).connectors == connectors


def test_preview_builds_vendor_payloads(mock_client):
    res = mock_client.post("/api/v1/dispatch/preview", json=ticket("P1"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mode"] == "sandbox"
    assert body["route"]["team"]["name"] == "Identity & Access Management"
    by = {}
    for d in body["deliveries"]:
        by.setdefault(d["connector"], []).append(d)
    # P1 pages #major-incidents (with @here) and the team channel.
    assert [d["target"] for d in by["slack"]] == ["#major-incidents", "#iam-ops"]
    assert by["slack"][0]["payload"]["text"].startswith("<!here>")
    assert by["slack"][0]["endpoint"] == "https://slack.com/api/chat.postMessage"
    jira = by["jira"][0]["payload"]["fields"]
    assert jira["project"] == {"key": "IAM"} and jira["priority"] == {"name": "Highest"}
    assert jira["description"]["type"] == "doc"
    snow = by["servicenow"][0]["payload"]
    assert (snow["impact"], snow["urgency"]) == ("1", "1")
    assert snow["assignment_group"] == "IAM - L2"
    card = by["teams"][0]["payload"]["attachments"][0]
    assert card["contentType"] == "application/vnd.microsoft.card.adaptive"
    assert by["crm"][0]["payload"]["Origin"] == "AI Triage"


def test_reviewer_override_is_visible_in_messages(mock_client):
    body = mock_client.post("/api/v1/dispatch/preview", json=ticket("P1")).json()
    notes = next(d for d in body["deliveries"] if d["connector"] == "servicenow")["payload"]["work_notes"]
    assert "Approved by Priya Raman" in notes and "(AI suggested P2)" in notes


def test_dispatch_records_sandbox_receipts(mock_client):
    res = mock_client.post("/api/v1/dispatch", json=ticket("P2"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["dispatch_id"].startswith("DSP-")
    refs = {r["connector"]: r["receipt"] for r in body["results"]}
    assert set(refs) == {"servicenow", "jira", "slack", "crm"}
    assert all(r["mode"] == "sandbox" and "not sent" in r["detail"] for r in refs.values())
    assert refs["servicenow"]["external_ref"].startswith("INC")
    assert refs["jira"]["external_ref"].startswith("IAM-")


def test_dispatch_subset_and_unknown_connector(mock_client):
    body = mock_client.post("/api/v1/dispatch", json=ticket("P2", connectors=["jira"])).json()
    assert [r["connector"] for r in body["results"]] == ["jira"]
    res = mock_client.post("/api/v1/dispatch", json=ticket("P2", connectors=["pagerduty"]))
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "bad_request"


def test_integrations_catalog(mock_client):
    body = mock_client.get("/api/v1/integrations").json()
    assert body["mode"] == "sandbox"
    ids = [c["id"] for c in body["connectors"]]
    assert ids == ["servicenow", "jira", "slack", "teams", "crm"]
    assert all(c["connected"] is False and c["go_live_env"] for c in body["connectors"])
    assert body["severity_rules"]["P4"] == ["servicenow"]


def test_dispatch_requires_reviewer(mock_client):
    res = mock_client.post("/api/v1/dispatch", json=ticket("P2", reviewer=""))
    assert res.status_code == 422
