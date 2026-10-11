"""FastAPI application factory.

Run:  uvicorn app.main:app --port 8000   (from the backend/ directory)
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.errors import register_exception_handlers
from app.api.routes import examples, health, integrations, tickets, triage
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.services.integrations.service import IntegrationService
from app.services.providers.base import InferenceProvider
from app.services.providers.factory import build_provider
from app.services.ticket_queue import TicketQueue, TicketService
from app.services.triage_service import TriageService

logger = logging.getLogger("app")


def create_app(
    settings: Settings | None = None,
    provider: InferenceProvider | None = None,
) -> FastAPI:
    """Build the app. `provider` can be injected (tests); otherwise built from settings."""
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    provider = provider or build_provider(settings)
    service = TriageService(
        provider,
        history_size=settings.history_size,
        severity_cross_check=settings.severity_cross_check,
        expose_raw_output=settings.expose_raw_output,
        triage_adapter_dir=settings.resolved_triage_adapter_path,
    )
    ticket_service = TicketService(TicketQueue.from_file(settings.resolved_tickets_path), provider, service)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info(
            "Starting API",
            extra={
                "provider": provider.name,
                "model_id": provider.model_id,
                "is_mock": provider.is_mock,
            },
        )
        provider.start()  # Gemma loads in a background thread; mock is immediate.
        yield
        provider.shutdown()
        logger.info("API stopped")

    app = FastAPI(
        title="Enterprise AI Incident Triage API",
        version=__version__,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.triage_service = service
    app.state.ticket_service = ticket_service
    app.state.integration_service = IntegrationService()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = uuid.uuid4().hex
        request.state.request_id = request_id
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "HTTP request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return response

    register_exception_handlers(app)
    app.include_router(health.router)
    app.include_router(triage.router)
    app.include_router(tickets.router)
    app.include_router(integrations.router)
    app.include_router(examples.router)
    return app


app = create_app()
