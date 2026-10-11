"""Local ticket queue (JSONL) with sequential issuing and post-inference evaluation.

Session state (which tickets were issued, analysis results) lives in process
memory: it is reset by POST /api/v1/tickets/reset or an API restart.

`expected_severity` is the reference label. It is stored only on `QueuedTicket`
and is read exclusively by `_evaluate()` *after* the provider has returned a
prediction. The provider receives `ticket.description` and nothing else.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from typing import TYPE_CHECKING

from app.services.errors import InferenceError, InvalidModelOutputError
from app.services.providers.base import InferenceProvider
from app.services.severity_parser import SEVERITIES, Severity

if TYPE_CHECKING:
    from app.schemas.incident import FullTriageResponse
    from app.services.triage_service import TriageService

logger = logging.getLogger(__name__)

REQUIRED_FIELDS = ("ticket_id", "title", "description", "expected_severity")


# --------------------------------------------------------------------------- errors
class TicketQueueError(Exception):
    """Base for queue errors; mirrors InferenceError (code, HTTP status, safe message)."""

    code = "ticket_error"
    http_status = 400
    public_message = "Ticket request failed."

    def __init__(self, public_message: str | None = None) -> None:
        self.public_message = public_message or self.public_message
        super().__init__(self.public_message)


class TicketsUnavailableError(TicketQueueError):
    code = "tickets_unavailable"
    http_status = 503
    public_message = "The ticket queue is unavailable."


class TicketNotFoundError(TicketQueueError):
    code = "not_found"
    http_status = 404
    public_message = "Unknown ticket_id."


class TicketNotIssuedError(TicketQueueError):
    code = "ticket_not_issued"
    http_status = 409
    public_message = "This ticket has not been issued in the current session. Use GET /api/v1/tickets/next."


# --------------------------------------------------------------------------- data
@dataclass(frozen=True)
class QueuedTicket:
    ticket_id: str
    title: str
    description: str
    expected_severity: Severity  # reference label: evaluation only
    position: int  # 1-based order in the file
    # Optional reference labels for full (five-field) evaluation.
    expected_category: str | None = None
    expected_root_cause: str | None = None
    #: Structured incident fields for the human-review ticket. Never sent to the model.
    incident: dict | None = None


@dataclass(frozen=True)
class TicketAnalysis:
    ticket_id: str
    title: str
    request_id: str
    predicted_severity: Severity | None  # None => model output was invalid
    expected_severity: Severity
    outcome: str  # "predicted" | "invalid_output"
    provider: str
    model_id: str
    is_mock: bool
    inference_ms: float | None
    analyzed_at: datetime
    mode: str = "severity"  # "severity" | "full"
    predicted_category: str | None = None
    predicted_root_cause: str | None = None
    expected_category: str | None = None
    expected_root_cause: str | None = None
    triage_severity: Severity | None = None  # triage adapter's own severity (full mode)
    full: "FullTriageResponse | None" = None

    @property
    def correct(self) -> bool | None:
        if self.predicted_severity is None:
            return None
        return self.predicted_severity == self.expected_severity

    def _field_correct(self, predicted: str | None, expected: str | None) -> bool | None:
        if self.mode != "full" or expected is None or self.predicted_severity is None:
            return None
        return predicted == expected

    @property
    def category_correct(self) -> bool | None:
        return self._field_correct(self.predicted_category, self.expected_category)

    @property
    def root_cause_correct(self) -> bool | None:
        return self._field_correct(self.predicted_root_cause, self.expected_root_cause)


def load_tickets(path: Path) -> list[QueuedTicket]:
    """Parse and validate the JSONL file. Raises TicketsUnavailableError with a safe message."""
    if not path.is_file():
        raise TicketsUnavailableError("Ticket file not found. Check TICKETS_PATH in backend/.env.")
    tickets: list[QueuedTicket] = []
    seen: set[str] = set()
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise TicketsUnavailableError(f"Ticket file line {line_no} is not valid JSON.") from exc
        if not isinstance(row, dict):
            raise TicketsUnavailableError(f"Ticket file line {line_no} is not a JSON object.")
        for field in REQUIRED_FIELDS:
            value = row.get(field)
            if not isinstance(value, str) or not value.strip():
                raise TicketsUnavailableError(f"Ticket file line {line_no}: '{field}' must be a non-empty string.")
        ticket_id = row["ticket_id"].strip()
        if ticket_id in seen:
            raise TicketsUnavailableError(f"Ticket file line {line_no}: duplicate ticket_id.")
        if row["expected_severity"] not in SEVERITIES:
            raise TicketsUnavailableError(f"Ticket file line {line_no}: expected_severity must be P1-P4.")
        seen.add(ticket_id)
        tickets.append(
            QueuedTicket(
                ticket_id=ticket_id,
                title=row["title"].strip(),
                description=row["description"].strip(),
                expected_severity=row["expected_severity"],
                position=len(tickets) + 1,
                expected_category=row.get("expected_category") or None,
                expected_root_cause=row.get("expected_root_cause") or None,
                incident=row.get("incident") if isinstance(row.get("incident"), dict) else None,
            )
        )
    if not tickets:
        raise TicketsUnavailableError("Ticket file contains no tickets.")
    return tickets


# --------------------------------------------------------------------------- queue
class TicketQueue:
    def __init__(self, tickets: list[QueuedTicket] | None, unavailable_reason: str | None = None) -> None:
        self._tickets = tickets or []
        self._by_id = {t.ticket_id: t for t in self._tickets}
        self._unavailable_reason = unavailable_reason
        self._lock = threading.Lock()
        self._issued = 0  # tickets[:_issued] have been handed out this session
        self._results: dict[str, TicketAnalysis] = {}

    @classmethod
    def from_file(cls, path: Path) -> "TicketQueue":
        try:
            tickets = load_tickets(path)
        except TicketsUnavailableError as exc:
            logger.error("Ticket queue unavailable", extra={"reason": exc.public_message, "path": str(path)})
            return cls(None, exc.public_message)
        logger.info("Ticket queue loaded", extra={"tickets": len(tickets)})
        return cls(tickets)

    # ---- state
    def _require_available(self) -> None:
        if self._unavailable_reason:
            raise TicketsUnavailableError(f"The ticket queue is unavailable: {self._unavailable_reason}")

    @property
    def total(self) -> int:
        return len(self._tickets)

    def snapshot(self) -> dict:
        """Current session state for GET /api/v1/tickets/session."""
        self._require_available()
        with self._lock:
            current = self._tickets[self._issued - 1] if self._issued else None
            return {
                "total": self.total,
                "issued": self._issued,
                "analyzed": len(self._results),
                "exhausted": self._issued >= self.total,
                "current": current,
                "current_analysis": self._results.get(current.ticket_id) if current else None,
            }

    def next(self) -> tuple[QueuedTicket | None, int]:
        """Issue the next ticket, never repeating one within a session.

        Returns (ticket, issued_count); ticket is None once the queue is exhausted.
        """
        self._require_available()
        with self._lock:
            if self._issued >= self.total:
                return None, self._issued
            ticket = self._tickets[self._issued]
            self._issued += 1
            return ticket, self._issued

    def reset(self) -> None:
        self._require_available()
        with self._lock:
            self._issued = 0
            self._results.clear()

    def issued_ticket(self, ticket_id: str) -> QueuedTicket:
        self._require_available()
        with self._lock:
            ticket = self._by_id.get(ticket_id)
            if ticket is None:
                raise TicketNotFoundError()
            if ticket.position > self._issued:
                raise TicketNotIssuedError()
            return ticket

    def record(self, analysis: TicketAnalysis) -> None:
        with self._lock:
            self._results[analysis.ticket_id] = analysis

    def results(self) -> list[TicketAnalysis]:
        self._require_available()
        with self._lock:
            return sorted(self._results.values(), key=lambda r: self._by_id[r.ticket_id].position)


# --------------------------------------------------------------------------- service
class TicketService:
    def __init__(
        self, queue: TicketQueue, provider: InferenceProvider, triage_service: "TriageService | None" = None
    ) -> None:
        self._queue = queue
        self._provider = provider
        self._triage = triage_service

    @property
    def queue(self) -> TicketQueue:
        return self._queue

    @property
    def provider(self) -> InferenceProvider:
        return self._provider

    def analyze(self, ticket_id: str, *, request_id: str) -> TicketAnalysis:
        ticket = self._queue.issued_ticket(ticket_id)

        # Inference input is the description ONLY. expected_severity is not read here.
        incident_text = ticket.description
        try:
            prediction = self._provider.predict_severity_from_text(incident_text)
        except InvalidModelOutputError:
            # A real model failure: recorded for evaluation as an invalid output
            # (never as a prediction), then surfaced to the client as an error.
            self._queue.record(self._evaluate(ticket, request_id, predicted=None, inference_ms=None))
            raise
        except InferenceError as exc:
            logger.warning(
                "Ticket inference error",
                extra={"request_id": request_id, "ticket_id": ticket_id, "error_code": exc.code},
            )
            raise

        analysis = self._evaluate(ticket, request_id, predicted=prediction.severity,
                                  inference_ms=prediction.inference_ms)
        self._queue.record(analysis)
        logger.info(
            "Ticket analyzed",
            extra={
                "request_id": request_id,
                "ticket_id": ticket_id,
                "provider": self._provider.name,
                "predicted": analysis.predicted_severity,
                "inference_ms": analysis.inference_ms,
            },
        )
        return analysis

    def analyze_full(self, ticket_id: str, *, request_id: str) -> TicketAnalysis:
        """Five-field triage of a queued ticket. The provider receives the description
        only; reference labels are attached afterwards for evaluation."""
        if self._triage is None:
            raise RuntimeError("TicketService was built without a TriageService")
        ticket = self._queue.issued_ticket(ticket_id)
        try:
            full = self._triage.full_triage_text(
                title=ticket.title, incident_text=ticket.description, request_id=request_id
            )
        except InvalidModelOutputError:
            self._queue.record(self._evaluate(ticket, request_id, predicted=None, inference_ms=None, mode="full"))
            raise
        a = full.analysis
        analysis = self._evaluate(
            ticket,
            request_id,
            predicted=full.severity,
            inference_ms=full.inference_ms,
            mode="full",
            predicted_category=a.category,
            predicted_root_cause=a.root_cause,
            triage_severity=a.severity,
            full=full,
        )
        self._queue.record(analysis)
        logger.info(
            "Ticket analyzed (full)",
            extra={"request_id": request_id, "ticket_id": ticket_id, "category": a.category, "severity": a.severity},
        )
        return analysis

    def _evaluate(self, ticket: QueuedTicket, request_id: str, *, predicted: Severity | None,
                  inference_ms: float | None, mode: str = "severity", predicted_category: str | None = None,
                  predicted_root_cause: str | None = None, triage_severity: Severity | None = None,
                  full: "FullTriageResponse | None" = None) -> TicketAnalysis:
        """Post-inference: attach the reference label to an already-made prediction."""
        return TicketAnalysis(
            ticket_id=ticket.ticket_id,
            title=ticket.title,
            request_id=request_id,
            predicted_severity=predicted,
            expected_severity=ticket.expected_severity,
            outcome="predicted" if predicted is not None else "invalid_output",
            provider=self._provider.name,
            model_id=full.model_id if full else self._provider.model_id,
            is_mock=self._provider.is_mock,
            inference_ms=inference_ms,
            analyzed_at=datetime.now(timezone.utc),
            mode=mode,
            predicted_category=predicted_category,
            predicted_root_cause=predicted_root_cause,
            expected_category=ticket.expected_category,
            expected_root_cause=ticket.expected_root_cause,
            triage_severity=triage_severity,
            full=full,
        )

    def evaluation(self) -> dict:
        results = self._queue.results()
        matrix: dict[str, dict[str, int]] = {
            exp: {**{pred: 0 for pred in SEVERITIES}, "invalid": 0} for exp in SEVERITIES
        }
        correct = invalid = 0
        for r in results:
            if r.predicted_severity is None:
                invalid += 1
                matrix[r.expected_severity]["invalid"] += 1
            else:
                matrix[r.expected_severity][r.predicted_severity] += 1
                correct += int(r.correct is True)
        analyzed = len(results)

        def field(name: str) -> dict[str, int]:
            values = [getattr(r, name) for r in results if r.mode == "full" and r.expected_category]
            return {"correct": sum(v is True for v in values), "total": len(values)}

        full = [r for r in results if r.mode == "full"]
        with_triage = [r for r in full if r.triage_severity is not None]
        field_metrics = {
            "category": field("category_correct"),
            "root_cause": field("root_cause_correct"),
            # For comparison only: the triage adapter's own severity (not the one shown).
            "triage_adapter_severity": {
                "correct": sum(r.triage_severity == r.expected_severity for r in with_triage),
                "total": len(with_triage),
            },
        }
        return {
            "provider": self._provider.name,
            "model_id": self._provider.model_id,
            "is_mock": self._provider.is_mock,
            "total_tickets": self._queue.total,
            "analyzed": analyzed,
            "correct": correct,
            "invalid_outputs": invalid,
            # Invalid outputs count as incorrect; None until something is analyzed.
            "accuracy": round(correct / analyzed, 4) if analyzed else None,
            "labels": list(SEVERITIES),
            "confusion_matrix": matrix,
            "full_analyzed": len(full),
            "field_metrics": field_metrics,
            "results": results,
        }
