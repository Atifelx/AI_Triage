"""Dispatch an approved review ticket to the owning team's systems.

preview() is side-effect free; dispatch() hands each delivery to its connector and keeps
an in-memory outbox (lost on restart, like the rest of the API's state).
"""

from __future__ import annotations

import itertools
import threading
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone

from app.services.integrations.connectors import (
    Connector,
    Delivery,
    DispatchContext,
    Receipt,
    build_connectors,
)
from app.services.integrations.routing import RoutePlan


class UnknownConnectorError(ValueError):
    pass


@dataclass(frozen=True)
class DispatchRecord:
    dispatch_id: str
    review_ticket_id: str
    created_at: datetime
    route: RoutePlan
    results: tuple[tuple[Delivery, Receipt], ...]


class IntegrationService:
    MODE = "sandbox"

    def __init__(self, outbox_size: int = 200) -> None:
        self.connectors: dict[str, Connector] = build_connectors()
        self._outbox: deque[DispatchRecord] = deque(maxlen=outbox_size)
        self._ids = itertools.count(1)
        self._lock = threading.Lock()

    def preview(self, ctx: DispatchContext) -> list[Delivery]:
        deliveries: list[Delivery] = []
        for connector_id in ctx.route.connectors:
            deliveries.extend(self.connectors[connector_id].build(ctx))
        return deliveries

    def dispatch(self, ctx: DispatchContext, only: list[str] | None = None) -> DispatchRecord:
        selected = list(ctx.route.connectors) if only is None else only
        unknown = [c for c in selected if c not in self.connectors]
        if unknown:
            raise UnknownConnectorError(f"Unknown connector(s): {', '.join(unknown)}")
        results: list[tuple[Delivery, Receipt]] = []
        with self._lock:
            for delivery in self.preview(ctx):
                if delivery.connector in selected:
                    results.append((delivery, self.connectors[delivery.connector].deliver(delivery)))
            record = DispatchRecord(
                dispatch_id=f"DSP-{next(self._ids):05d}",
                review_ticket_id=ctx.review_ticket_id,
                created_at=datetime.now(timezone.utc),
                route=ctx.route,
                results=tuple(results),
            )
            self._outbox.appendleft(record)
        return record

    def outbox(self) -> list[DispatchRecord]:
        with self._lock:
            return list(self._outbox)
