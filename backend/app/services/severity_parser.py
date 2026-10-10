"""Strict validation of raw provider output into a severity label.

The severity adapter was trained to emit exactly ``{"severity":"P1"}``.
Anything else is rejected; we never guess or repair a prediction.
"""

from __future__ import annotations

import json
from typing import Final, Literal, get_args

from app.services.errors import InvalidModelOutputError

Severity = Literal["P1", "P2", "P3", "P4"]
SEVERITIES: Final[tuple[str, ...]] = get_args(Severity)


def parse_severity_output(raw: str) -> Severity:
    """Parse raw generated text. Raises InvalidModelOutputError on any deviation."""
    if not isinstance(raw, str):
        raise InvalidModelOutputError(internal_detail=f"non-string output: {type(raw).__name__}")

    text = raw.strip()
    if not text:
        raise InvalidModelOutputError(internal_detail="empty output")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise InvalidModelOutputError(internal_detail=f"not valid JSON: {text[:200]!r}") from exc

    if not isinstance(parsed, dict):
        raise InvalidModelOutputError(internal_detail=f"JSON is not an object: {text[:200]!r}")

    if set(parsed.keys()) != {"severity"}:
        raise InvalidModelOutputError(
            internal_detail=f"unexpected keys {sorted(parsed.keys())!r}"
        )

    severity = parsed["severity"]
    if severity not in SEVERITIES:
        raise InvalidModelOutputError(internal_detail=f"invalid severity value {severity!r}")

    return severity  # type: ignore[return-value]
