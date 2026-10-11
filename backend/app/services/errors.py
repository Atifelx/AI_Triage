"""Controlled inference errors.

Each error carries a stable machine-readable `code`, an HTTP status, and a
public message that is safe to return to clients (no paths, no stack traces).
"""

from __future__ import annotations


class InferenceError(Exception):
    code = "inference_error"
    http_status = 500
    public_message = "Inference failed."

    def __init__(self, public_message: str | None = None, *, internal_detail: str | None = None):
        self.public_message = public_message or self.public_message
        # internal_detail is for server logs only.
        self.internal_detail = internal_detail
        super().__init__(self.public_message)


class ProviderNotReadyError(InferenceError):
    """Provider is still initialising (e.g. model loading)."""

    code = "provider_not_ready"
    http_status = 503
    public_message = "The inference provider is not ready yet. Try again shortly."


class ProviderUnavailableError(InferenceError):
    """Provider failed to initialise and cannot serve requests."""

    code = "provider_unavailable"
    http_status = 503
    public_message = "The inference provider is unavailable."


class InferenceFailedError(InferenceError):
    """The provider raised while running inference."""

    code = "inference_failed"
    http_status = 500
    public_message = "Inference failed while processing this incident."


class InvalidModelOutputError(InferenceError):
    """The model produced output that does not match the expected JSON contract."""

    code = "invalid_model_output"
    http_status = 502
    public_message = "The model returned an invalid severity output. No prediction was made."

    def __init__(
        self,
        public_message: str | None = None,
        *,
        internal_detail: str | None = None,
        raw_output: str | None = None,
    ):
        super().__init__(public_message, internal_detail=internal_detail)
        # Exact generated text; returned to clients only when EXPOSE_RAW_OUTPUT is on.
        self.raw_output = raw_output


class TriageUnavailableError(InferenceError):
    """Full (five-field) triage was requested but no triage adapter is loaded."""

    code = "triage_unavailable"
    http_status = 503
    public_message = (
        "Full incident triage is not available: no incident-triage adapter is loaded. "
        "Severity-only triage still works."
    )


class InferenceTimeoutError(InferenceError):
    """Generation hit the configured time limit before finishing."""

    code = "inference_timeout"
    http_status = 504
    public_message = "The model did not finish within the time limit. No prediction was made."
