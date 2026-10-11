"""Ticket queue full (five-field) analysis and manual-triage examples."""

from __future__ import annotations

import json

from app.services.providers.mock_provider import MockInferenceProvider
from tests.conftest import BACKEND_DIR, client_for


def _issue(client) -> dict:
    return client.get("/api/v1/tickets/next").json()["ticket"]


def test_full_analysis_of_queued_ticket():
    with client_for(MockInferenceProvider()) as client:
        ticket = _issue(client)
        res = client.post(f"/api/v1/tickets/{ticket['ticket_id']}/analyze/full")
        assert res.status_code == 200, res.text
        body = res.json()
        triage = body["triage"]
        assert set(triage["analysis"]) == {"category", "severity", "root_cause", "evidence", "recommended_actions"}
        # The model saw the ticket text exactly, nothing else.
        assert triage["incident_text"] == ticket["description"]
        assert body["expected_category"] and body["expected_root_cause"]
        assert body["category_correct"] == (triage["analysis"]["category"] == body["expected_category"])

        session = client.get("/api/v1/tickets/session").json()
        assert session["current_analysis"]["mode"] == "full"
        assert session["current_analysis"]["triage"]["request_id"] == triage["request_id"]

        ev = client.get("/api/v1/tickets/evaluation").json()
        assert ev["full_analyzed"] == 1
        assert ev["field_metrics"]["category"]["total"] == 1
        assert ev["results"][0]["triage"] is None  # evaluation list stays light


def test_full_analysis_requires_issued_ticket():
    with client_for(MockInferenceProvider()) as client:
        res = client.post("/api/v1/tickets/NOT-ISSUED/analyze/full")
        assert res.status_code in (404, 409)


def test_examples_endpoint_serves_50_unique_heldout_examples(mock_client):
    body = mock_client.get("/api/v1/examples").json()
    examples = body["examples"]
    assert len(examples) == 50
    assert len({e["description"] for e in examples}) == 50
    assert {e["reference"]["severity"] for e in examples} == {"P1", "P2", "P3", "P4"}
    queue = {json.loads(l)["description"] for l in (BACKEND_DIR / "data/tickets.jsonl").read_text().splitlines() if l.strip()}
    assert not any(e["description"] in q for e in examples for q in queue)  # no overlap with the queue


def test_queued_ticket_carries_review_fields_but_model_gets_description_only():
    with client_for(MockInferenceProvider(), expose_raw_output=True) as client:
        ticket = _issue(client)
        incident = ticket["incident"]
        assert incident and incident["title"] == ticket["title"]
        assert incident["affected_service"] and incident["business_impact"]
        body = client.post(f"/api/v1/tickets/{ticket['ticket_id']}/analyze/full").json()
        assert body["triage"]["incident_text"] == ticket["description"]
