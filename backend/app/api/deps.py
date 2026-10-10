from __future__ import annotations

import uuid

from fastapi import Request

from app.services.triage_service import TriageService


def get_triage_service(request: Request) -> TriageService:
    return request.app.state.triage_service


def get_request_id(request: Request) -> str:
    # Set by the request-context middleware in app.main.
    return getattr(request.state, "request_id", None) or uuid.uuid4().hex
