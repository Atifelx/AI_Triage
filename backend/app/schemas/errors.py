from __future__ import annotations

from pydantic import BaseModel


class FieldError(BaseModel):
    field: str
    message: str


class ErrorBody(BaseModel):
    code: str
    message: str
    request_id: str | None = None
    details: list[FieldError] | None = None
    # Exact model output; only included when EXPOSE_RAW_OUTPUT is enabled.
    raw_output: str | None = None


class ErrorResponse(BaseModel):
    """Envelope for every non-2xx response."""

    error: ErrorBody
