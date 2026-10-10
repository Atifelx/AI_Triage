"""GemmaSeverityProvider — Gemma 3 270M IT + severity LoRA adapter.

* Loads base model + PEFT adapter exactly once, in a background thread started at
  application startup (`start()`), so /health can truthfully report "loading".
* Device: auto -> cuda -> mps -> cpu. An explicitly requested device that is not
  available is a load failure (no silent device switch).
* eval() + torch.inference_mode() + greedy decoding (do_sample=False).
* Output is validated strictly by the base class; invalid output is an error.
* On any failure the provider reports UNAVAILABLE. It never falls back to mock.

torch / transformers / peft are imported lazily so the API and test suite run
without them when INFERENCE_PROVIDER=mock.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any

from app.services.errors import InferenceFailedError
from app.services.providers.base import (
    IncidentInput,
    InferenceProvider,
    ProviderState,
    ProviderStatus,
)
from app.services.providers.gemma_prompt import (
    TRAINING_MAX_LENGTH,
    build_chat_messages,
    build_text_chat_messages,
)

logger = logging.getLogger(__name__)


class ModelLoadError(Exception):
    """Raised during loading. `public_message` is safe to expose via /health."""

    def __init__(self, public_message: str, internal_detail: str | None = None):
        self.public_message = public_message
        self.internal_detail = internal_detail
        super().__init__(public_message)


def resolve_device(preference: str, *, cuda_available: bool, mps_available: bool) -> str:
    """Pick the torch device. Pure function so it can be tested without torch."""
    if preference == "auto":
        if cuda_available:
            return "cuda"
        if mps_available:
            return "mps"
        return "cpu"
    if preference == "cuda" and not cuda_available:
        raise ModelLoadError("DEVICE=cuda was requested but CUDA is not available.")
    if preference == "mps" and not mps_available:
        raise ModelLoadError("DEVICE=mps was requested but Apple MPS is not available.")
    if preference not in ("cpu", "cuda", "mps"):
        raise ModelLoadError(f"Unsupported DEVICE value: {preference!r}.")
    return preference


def adapter_label(adapter_path: Path) -> str:
    """Public adapter name derived from the path (directory name only, no path)."""
    leaf = adapter_path.name
    if leaf in {"best_adapter", "final_adapter", "adapter"} and adapter_path.parent.name:
        return adapter_path.parent.name
    return leaf


class GemmaSeverityProvider(InferenceProvider):
    name = "gemma"
    is_mock = False

    def __init__(
        self,
        *,
        base_model_id: str,
        adapter_path: Path,
        base_model_path: Path | None = None,
        device: str = "auto",
        max_new_tokens: int = 32,
    ) -> None:
        self._base_model_id = base_model_id
        # Local copy of the base weights; None -> resolve base_model_id via the HF hub/cache.
        self._base_model_path = base_model_path
        self._adapter_path = adapter_path
        self._device_pref = device
        self._max_new_tokens = max_new_tokens

        self._state = ProviderState.NOT_LOADED
        self._detail: str | None = "Model has not been loaded yet."
        self._device: str | None = None
        self._state_lock = threading.Lock()
        self._generate_lock = threading.Lock()  # one generate() at a time
        self._loader_thread: threading.Thread | None = None

        self._torch: Any = None
        self._tokenizer: Any = None
        self._model: Any = None

    # ------------------------------------------------------------------ identity
    @property
    def model_id(self) -> str:
        return f"{self._base_model_id} + LoRA:{adapter_label(self._adapter_path)}"

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        """Start loading in a background thread (idempotent)."""
        with self._state_lock:
            if self._state in (ProviderState.LOADING, ProviderState.READY):
                return
            self._state = ProviderState.LOADING
            self._detail = "Loading base model and LoRA adapter."
        self._loader_thread = threading.Thread(
            target=self._load_safely, name="gemma-loader", daemon=True
        )
        self._loader_thread.start()

    def wait_until_settled(self, timeout: float | None = None) -> None:
        """Block until loading finished (success or failure). Used by tests/CLI."""
        if self._loader_thread is not None:
            self._loader_thread.join(timeout)

    def shutdown(self) -> None:
        self._model = None
        self._tokenizer = None

    def status(self) -> ProviderStatus:
        with self._state_lock:
            return ProviderStatus(
                state=self._state,
                model_loaded=self._state is ProviderState.READY,
                device=self._device,
                detail=self._detail,
            )

    def _load_safely(self) -> None:
        started = time.perf_counter()
        try:
            self._load()
        except ModelLoadError as exc:
            logger.error(
                "Gemma provider failed to load",
                extra={"reason": exc.public_message, "detail": exc.internal_detail},
            )
            self._set_state(ProviderState.UNAVAILABLE, exc.public_message)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Gemma provider failed to load (unexpected error)")
            self._set_state(
                ProviderState.UNAVAILABLE,
                f"Model failed to load ({type(exc).__name__}). See backend logs.",
            )
        else:
            logger.info(
                "Gemma provider ready",
                extra={
                    "model_id": self.model_id,
                    "device": self._device,
                    "load_seconds": round(time.perf_counter() - started, 2),
                },
            )
            self._set_state(ProviderState.READY, "Model loaded.")

    def _set_state(self, state: ProviderState, detail: str | None) -> None:
        with self._state_lock:
            self._state = state
            self._detail = detail

    def _load(self) -> None:
        adapter = self._adapter_path
        if not adapter.is_dir():
            raise ModelLoadError(
                "Adapter directory not found. Check ADAPTER_PATH in backend/.env.",
                internal_detail=str(adapter),
            )
        if not (adapter / "adapter_config.json").is_file():
            raise ModelLoadError(
                "Adapter directory does not contain adapter_config.json.",
                internal_detail=str(adapter),
            )
        base_source = self._base_model_id
        if self._base_model_path is not None:
            if not (self._base_model_path / "config.json").is_file():
                raise ModelLoadError(
                    "Base model directory not found or incomplete. Check BASE_MODEL_PATH in backend/.env.",
                    internal_detail=str(self._base_model_path),
                )
            if not any(self._base_model_path.glob("*.safetensors")):
                # The repo ships configs only; the weights are fetched separately.
                raise ModelLoadError(
                    "Base model weights are not downloaded yet. "
                    "Run: python scripts/download_model.py (in backend/), then restart the API.",
                    internal_detail=str(self._base_model_path),
                )
            base_source = str(self._base_model_path)

        try:
            import torch
            from peft import PeftModel
            from transformers import AutoModelForCausalLM, AutoTokenizer
        except ImportError as exc:
            raise ModelLoadError(
                "torch, transformers and peft must be installed for INFERENCE_PROVIDER=gemma "
                "(pip install -r requirements-gemma.txt).",
                internal_detail=repr(exc),
            ) from exc

        device = resolve_device(
            self._device_pref,
            cuda_available=torch.cuda.is_available(),
            mps_available=bool(
                getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()
            ),
        )
        with self._state_lock:
            self._device = device

        logger.info(
            "Loading Gemma severity model",
            extra={"base_model": base_source, "adapter": str(adapter), "device": device},
        )

        # The training script saved the tokenizer (incl. chat template) with the adapter;
        # the evaluation script loads it from there too.
        tokenizer = AutoTokenizer.from_pretrained(str(adapter))
        # float32 matches training and evaluation.
        base = AutoModelForCausalLM.from_pretrained(
            base_source,
            dtype=torch.float32,
            # Local folder: never touch the network.
            local_files_only=self._base_model_path is not None,
        )
        base.to(device)
        model = PeftModel.from_pretrained(base, str(adapter))
        model.eval()

        self._torch = torch
        self._tokenizer = tokenizer
        self._model = model

    # ------------------------------------------------------------------ inference
    def _infer_raw(self, incident: IncidentInput) -> str:
        if self._model is None or self._tokenizer is None:
            # Should be unreachable because predict_severity() checks readiness first.
            raise InferenceFailedError(internal_detail="model not loaded")
        return self._generate(build_chat_messages(incident))

    def _infer_raw_text(self, incident_text: str) -> str:
        if self._model is None or self._tokenizer is None:
            raise InferenceFailedError(internal_detail="model not loaded")
        return self._generate(build_text_chat_messages(incident_text))

    def _generate(self, messages: list[dict[str, str]]) -> str:
        torch = self._torch
        tokenizer = self._tokenizer

        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        # The chat template already emits <bos>; match training (no extra specials).
        encoded = tokenizer(prompt, return_tensors="pt", add_special_tokens=False)
        prompt_tokens = int(encoded["input_ids"].shape[1])
        if prompt_tokens > TRAINING_MAX_LENGTH:
            logger.warning(
                "Prompt longer than training max length",
                extra={"prompt_tokens": prompt_tokens, "training_max_length": TRAINING_MAX_LENGTH},
            )
        encoded = {k: v.to(self._device) for k, v in encoded.items()}

        with self._generate_lock, torch.inference_mode():
            output = self._model.generate(
                **encoded,
                max_new_tokens=self._max_new_tokens,
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )

        generated = output[0][prompt_tokens:]
        raw = tokenizer.decode(generated, skip_special_tokens=True).strip()
        logger.debug("Gemma raw output", extra={"raw_output": raw[:200]})
        return raw
