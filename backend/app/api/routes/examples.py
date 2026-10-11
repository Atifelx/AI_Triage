"""Manual-triage examples: 50 held-out incidents (never trained on), in form fields.

Built by scripts/build_demo_data.py. `reference` holds the dataset labels; the UI reveals
it only after inference and never sends it to the model.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.schemas.incident import Severity

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["examples"])


class ExampleReference(BaseModel):
    severity: Severity
    category: str
    root_cause: str


class ExampleOut(BaseModel):
    source_id: str
    title: str
    description: str
    affected_service: str
    affected_users: int
    affected_departments: list[str]
    affected_sites: list[str]
    business_impact: str
    workaround_available: bool | None
    diagnostic_evidence: str
    scope_check: str
    additional_context: str
    reference: ExampleReference


class ExamplesResponse(BaseModel):
    source: str
    examples: list[ExampleOut]


@lru_cache(maxsize=4)
def load_examples(path: Path) -> tuple[ExampleOut, ...]:
    if not path.is_file():
        logger.warning("Examples file not found", extra={"path": str(path)})
        return ()
    return tuple(
        ExampleOut(**json.loads(line)) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()
    )


@router.get("/examples", response_model=ExamplesResponse)
def list_examples(request: Request) -> ExamplesResponse:
    settings = request.app.state.settings
    return ExamplesResponse(
        source="Held-out validation split (training/data/incident_val_v3.jsonl); not used in training.",
        examples=list(load_examples(settings.resolved_examples_path)),
    )
