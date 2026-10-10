"""Exception handlers producing a uniform error envelope.

Responses never include stack traces, filesystem paths or environment values.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.errors import ErrorBody, ErrorResponse, FieldError
from app.services.errors import InferenceError
from app.services.ticket_queue import TicketQueueError

logger = logging.getLogger(__name__)


class NotFoundError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _error(
    request: Request,
    status: int,
    code: str,
    message: str,
    details: list[FieldError] | None = None,
) -> JSONResponse:
    body = ErrorResponse(
        error=ErrorBody(code=code, message=message, request_id=_request_id(request), details=details)
    )
    return JSONResponse(status_code=status, content=body.model_dump(exclude_none=True))


def _field_name(loc: tuple) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path")]
    return ".".join(parts) if parts else "body"


async def _validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    details: list[FieldError] = []
    for err in exc.errors():
        if err.get("type") == "json_invalid":
            return _error(request, 422, "invalid_json", "Request body must be valid JSON.")
        message = str(err.get("msg", "Invalid value"))
        if err.get("type") == "missing":
            message = "This field is required."
        elif err.get("type") == "extra_forbidden":
            message = "Unknown field."
        details.append(FieldError(field=_field_name(tuple(err.get("loc", ()))), message=message))
    return _error(request, 422, "validation_error", "The request is invalid.", details)


async def _inference_handler(request: Request, exc: InferenceError) -> JSONResponse:
    return _error(request, exc.http_status, exc.code, exc.public_message)


async def _ticket_handler(request: Request, exc: TicketQueueError) -> JSONResponse:
    return _error(request, exc.http_status, exc.code, exc.public_message)


async def _not_found_handler(request: Request, exc: NotFoundError) -> JSONResponse:
    return _error(request, 404, "not_found", exc.message)


async def _http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
    message = exc.detail if isinstance(exc.detail, str) else "HTTP error"
    return _error(request, exc.status_code, code, message)


async def _unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error", extra={"request_id": _request_id(request)})
    return _error(request, 500, "internal_error", "An unexpected error occurred.")


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(InferenceError, _inference_handler)  # type: ignore[arg-type]
    app.add_exception_handler(TicketQueueError, _ticket_handler)  # type: ignore[arg-type]
    app.add_exception_handler(NotFoundError, _not_found_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, _http_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, _unhandled_handler)
