"""Ticket queue API: sequencing, label isolation, evaluation, failure handling."""

from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from app.core.config import BACKEND_DIR
from app.services.providers.base import IncidentInput, InferenceProvider, ProviderState, ProviderStatus
from app.services.providers.gemma_prompt import SEVERITY_INSTRUCTION
from app.services.providers.gemma_provider import GemmaSeverityProvider
from app.services.providers.mock_provider import MockInferenceProvider, synthetic_severity_from_text
from app.services.ticket_queue import load_tickets

TICKETS = [
    {"ticket_id": "T-1", "title": "Incident T-1", "description": "Scope: entire company offline.", "expected_severity": "P1"},
    {"ticket_id": "T-2", "title": "Incident T-2", "description": "Scope: one department blocked.", "expected_severity": "P2"},
    {"ticket_id": "T-3", "title": "Incident T-3", "description": "Scope: one laptop affected.", "expected_severity": "P3"},
]


@pytest.fixture
def tickets_file(tmp_path: Path) -> Path:
    path = tmp_path / "tickets.jsonl"
    path.write_text("".join(json.dumps(t) + "\n" for t in TICKETS))
    return path


class SpyProvider(InferenceProvider):
    """Records exactly what reaches the provider; answers from a fixed script."""

    name = "spy"
    is_mock = False

    def __init__(self, answers: dict[str, str] | None = None, state: ProviderState = ProviderState.READY):
        self.answers = answers or {}
        self.state = state
        self.received: list[str] = []

    @property
    def model_id(self) -> str:
        return "spy-model"

    def status(self) -> ProviderStatus:
        return ProviderStatus(state=self.state, model_loaded=self.state is ProviderState.READY)

    def _infer_raw(self, incident: IncidentInput) -> str:
        raise AssertionError("ticket analysis must use the free-text path")

    def _infer_raw_text(self, incident_text: str) -> str:
        self.received.append(incident_text)
        return self.answers.get(incident_text, '{"severity":"P1"}')


class CapturingGemma(GemmaSeverityProvider):
    """Real GemmaSeverityProvider prompt/validation path; only weights and generate() are faked."""

    def __init__(self, raw_output: str = '{"severity":"P2"}'):
        super().__init__(base_model_id="google/gemma-3-270m-it", adapter_path=Path("x/adapter"))
        self.raw_output = raw_output
        self.messages: list[list[dict[str, str]]] = []

    def _load(self) -> None:
        self._device, self._model, self._tokenizer = "cpu", object(), object()

    def _generate(self, messages):  # type: ignore[override]
        self.messages.append(messages)
        return self.raw_output


def _next(client) -> dict:
    res = client.get("/api/v1/tickets/next")
    assert res.status_code == 200, res.text
    return res.json()


# ------------------------------------------------------------------- sequencing
def test_next_issues_tickets_in_order_without_labels(make_client, tickets_file):
    with make_client(SpyProvider(), tickets_path=str(tickets_file)) as client:
        issued = [_next(client) for _ in range(3)]
    assert [b["ticket"]["ticket_id"] for b in issued] == ["T-1", "T-2", "T-3"]
    assert [b["ticket"]["position"] for b in issued] == [1, 2, 3]
    assert all(b["ticket"]["total"] == 3 and not b["exhausted"] for b in issued)
    for body in issued:
        assert "expected_severity" not in json.dumps(body)


def test_end_of_queue_never_reuses_tickets(make_client, tickets_file):
    with make_client(SpyProvider(), tickets_path=str(tickets_file)) as client:
        ids = [_next(client)["ticket"]["ticket_id"] for _ in range(3)]
        end = _next(client)
        again = _next(client)
    assert len(set(ids)) == 3
    for body in (end, again):
        assert body["ticket"] is None
        assert body["exhausted"] is True
        assert body["issued"] == 3
        assert "End of queue" in body["message"]


def test_session_restores_current_ticket_without_advancing(make_client, tickets_file):
    with make_client(SpyProvider(), tickets_path=str(tickets_file)) as client:
        empty = client.get("/api/v1/tickets/session").json()
        _next(client)
        client.post("/api/v1/tickets/T-1/analyze")
        first = client.get("/api/v1/tickets/session").json()
        second = client.get("/api/v1/tickets/session").json()
    assert empty["current"] is None and empty["issued"] == 0
    assert first == second  # GET /session is side-effect free
    assert first["current"]["ticket_id"] == "T-1"
    assert first["current_analysis"]["predicted_severity"] == "P1"
    assert "expected_severity" not in first["current"]


def test_reset_starts_a_new_session(make_client, tickets_file):
    with make_client(SpyProvider(), tickets_path=str(tickets_file)) as client:
        _next(client)
        client.post("/api/v1/tickets/T-1/analyze")
        reset = client.post("/api/v1/tickets/reset").json()
        evaluation = client.get("/api/v1/tickets/evaluation").json()
        first_again = _next(client)
    assert reset["issued"] == 0 and reset["analyzed"] == 0
    assert evaluation["analyzed"] == 0
    assert first_again["ticket"]["ticket_id"] == "T-1"


# ------------------------------------------------------------------- label isolation
def test_provider_receives_only_the_description(make_client, tickets_file):
    spy = SpyProvider()
    with make_client(spy, tickets_path=str(tickets_file)) as client:
        for _ in TICKETS:
            ticket = _next(client)["ticket"]
            assert client.post(f"/api/v1/tickets/{ticket['ticket_id']}/analyze").status_code == 200
    assert spy.received == [t["description"] for t in TICKETS]
    for text, ticket in zip(spy.received, TICKETS):
        assert ticket["expected_severity"] not in text
        assert ticket["title"] not in text


def test_gemma_ticket_prompt_is_training_format_without_label(make_client, tickets_file):
    gemma = CapturingGemma(raw_output='{"severity":"P2"}')
    with make_client(gemma, tickets_path=str(tickets_file)) as client:
        _next(client)
        res = client.post("/api/v1/tickets/T-1/analyze")
    assert res.status_code == 200, res.text
    (messages,) = gemma.messages
    assert messages == [{"role": "user", "content": SEVERITY_INSTRUCTION + "\n\n" + TICKETS[0]["description"]}]
    content = messages[0]["content"]
    assert "expected_severity" not in content
    assert TICKETS[0]["title"] not in content
    body = res.json()
    assert body["provider"] == "gemma" and body["is_mock"] is False
    assert body["severity"] == "P2"
    # Label attached only after inference, for evaluation.
    assert body["expected_severity"] == "P1" and body["correct"] is False


# ------------------------------------------------------------------- analyze + errors
def test_analyze_mock_is_labelled_synthetic(make_client, tickets_file):
    with make_client(MockInferenceProvider(latency_ms=0), tickets_path=str(tickets_file)) as client:
        _next(client)
        body = client.post("/api/v1/tickets/T-1/analyze").json()
    assert body["provider"] == "mock" and body["is_mock"] is True
    assert body["severity"] == synthetic_severity_from_text(TICKETS[0]["description"])
    assert body["human_review_required"] is True
    assert body["inference_ms"] >= 0


def test_mock_text_rule_is_deterministic_and_content_blind():
    assert synthetic_severity_from_text("abc") == synthetic_severity_from_text("  abc ")
    labels = {synthetic_severity_from_text(f"ticket {i}") for i in range(200)}
    assert labels == {"P1", "P2", "P3", "P4"}


def test_analyze_unissued_and_unknown_tickets(make_client, tickets_file):
    with make_client(SpyProvider(), tickets_path=str(tickets_file)) as client:
        not_issued = client.post("/api/v1/tickets/T-2/analyze")
        unknown = client.post("/api/v1/tickets/NOPE/analyze")
        bad_id = client.post("/api/v1/tickets/bad%20id/analyze")
    assert not_issued.status_code == 409
    assert not_issued.json()["error"]["code"] == "ticket_not_issued"
    assert unknown.status_code == 404
    assert bad_id.status_code == 422


def test_invalid_model_output_is_recorded_not_predicted(make_client, tickets_file):
    gemma = CapturingGemma(raw_output="I think it is high severity")
    with make_client(gemma, tickets_path=str(tickets_file)) as client:
        _next(client)
        res = client.post("/api/v1/tickets/T-1/analyze")
        evaluation = client.get("/api/v1/tickets/evaluation").json()
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "invalid_model_output"
    assert "severity" not in res.json()
    assert evaluation["analyzed"] == 1 and evaluation["invalid_outputs"] == 1
    assert evaluation["accuracy"] == 0.0
    assert evaluation["confusion_matrix"]["P1"]["invalid"] == 1
    (row,) = evaluation["results"]
    assert row["outcome"] == "invalid_output" and row["predicted_severity"] is None and row["correct"] is None


def test_provider_not_ready_records_nothing(make_client, tickets_file):
    spy = SpyProvider(state=ProviderState.LOADING)
    with make_client(spy, tickets_path=str(tickets_file)) as client:
        _next(client)
        res = client.post("/api/v1/tickets/T-1/analyze")
        evaluation = client.get("/api/v1/tickets/evaluation").json()
    assert res.status_code == 503 and res.json()["error"]["code"] == "provider_not_ready"
    assert spy.received == []
    assert evaluation["analyzed"] == 0


def test_gemma_load_failure_never_returns_mock(make_client, tickets_file, tmp_path):
    provider = GemmaSeverityProvider(base_model_id="google/gemma-3-270m-it", adapter_path=tmp_path / "missing")
    with make_client(provider, tickets_path=str(tickets_file)) as client:
        _next(client)
        res = client.post("/api/v1/tickets/T-1/analyze")
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "provider_unavailable"
    assert "mock" not in res.text.lower()


# ------------------------------------------------------------------- evaluation
def test_evaluation_accuracy_and_confusion_matrix(make_client, tickets_file):
    answers = {
        TICKETS[0]["description"]: '{"severity":"P1"}',  # correct
        TICKETS[1]["description"]: '{"severity":"P1"}',  # P2 predicted as P1
        TICKETS[2]["description"]: '{"severity":"P3"}',  # correct
    }
    with make_client(SpyProvider(answers), tickets_path=str(tickets_file)) as client:
        for _ in TICKETS:
            tid = _next(client)["ticket"]["ticket_id"]
            client.post(f"/api/v1/tickets/{tid}/analyze")
        client.post("/api/v1/tickets/T-1/analyze")  # re-analysis replaces, never double-counts
        ev = client.get("/api/v1/tickets/evaluation").json()
    assert ev["provider"] == "spy" and ev["is_mock"] is False
    assert ev["analyzed"] == 3 and ev["correct"] == 2 and ev["invalid_outputs"] == 0
    assert ev["accuracy"] == pytest.approx(0.6667)
    m = ev["confusion_matrix"]
    assert m["P1"]["P1"] == 1 and m["P2"]["P1"] == 1 and m["P3"]["P3"] == 1
    assert sum(sum(row.values()) for row in m.values()) == 3
    assert [r["ticket_id"] for r in ev["results"]] == ["T-1", "T-2", "T-3"]
    assert [r["correct"] for r in ev["results"]] == [True, False, True]


def test_empty_evaluation_has_no_accuracy(make_client, tickets_file):
    with make_client(SpyProvider(), tickets_path=str(tickets_file)) as client:
        ev = client.get("/api/v1/tickets/evaluation").json()
    assert ev["analyzed"] == 0 and ev["accuracy"] is None


# ------------------------------------------------------------------- ticket file
@pytest.mark.parametrize(
    "content",
    [
        "not json\n",
        json.dumps({**TICKETS[0], "expected_severity": "P9"}) + "\n",
        json.dumps({k: v for k, v in TICKETS[0].items() if k != "description"}) + "\n",
        json.dumps(TICKETS[0]) + "\n" + json.dumps(TICKETS[0]) + "\n",  # duplicate id
        "\n",
    ],
)
def test_invalid_ticket_file_is_503_but_api_stays_up(make_client, tmp_path, content):
    path = tmp_path / "bad.jsonl"
    path.write_text(content)
    with make_client(SpyProvider(), tickets_path=str(path)) as client:
        res = client.get("/api/v1/tickets/next")
        health = client.get("/health")
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "tickets_unavailable"
    assert str(tmp_path) not in res.text
    assert health.status_code == 200


def test_missing_ticket_file(make_client, tmp_path):
    with make_client(SpyProvider(), tickets_path=str(tmp_path / "nope.jsonl")) as client:
        res = client.get("/api/v1/tickets/session")
    assert res.status_code == 503


def test_shipped_ticket_file_is_valid():
    tickets = load_tickets(BACKEND_DIR / "data" / "tickets.jsonl")
    assert len(tickets) == 120
    assert len({t.ticket_id for t in tickets}) == 120
    assert len({t.description for t in tickets}) == 120
    assert all(t.expected_category and t.expected_root_cause for t in tickets)
    training = BACKEND_DIR.parent / "training" / "data" / "incident_train_v3.jsonl"
    if training.is_file():  # held-out only: no ticket may come from the training split
        trained = {json.loads(line)["input"] for line in training.read_text().splitlines() if line.strip()}
        assert not trained & {t.description for t in tickets}


def test_concurrent_next_calls_never_duplicate(make_client, tickets_file):
    with make_client(SpyProvider(), tickets_path=str(tickets_file)) as client:
        results: list[str | None] = []
        lock = threading.Lock()

        def worker():
            body = _next(client)
            with lock:
                results.append(body["ticket"]["ticket_id"] if body["ticket"] else None)

        threads = [threading.Thread(target=worker) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    issued = [r for r in results if r]
    assert sorted(issued) == ["T-1", "T-2", "T-3"]
    assert results.count(None) == 3
