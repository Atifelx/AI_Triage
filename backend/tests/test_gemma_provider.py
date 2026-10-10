"""Gemma provider pieces that can be verified without torch or model weights."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.providers.base import IncidentInput
from app.services.providers.gemma_prompt import (
    INSTRUCTION_SEPARATOR,
    SEVERITY_INSTRUCTION,
    build_chat_messages,
    build_user_message,
    render_incident_text,
)
from app.services.providers.gemma_provider import (
    GemmaSeverityProvider,
    ModelLoadError,
    adapter_label,
    resolve_device,
)

INCIDENT = IncidentInput(
    title="Microsoft 365 sign-in failures",
    description="Multiple employees cannot sign in",
    affected_service="Microsoft 365",
    affected_users=45,
    business_impact="Employees cannot access business applications.",
    affected_departments=("Finance", "Operations"),
    affected_sites=("Mumbai", "Pune"),
    workaround_available=False,
    diagnostic_evidence="Authentication failures reported by affected users.",
)


# ---------------------------------------------------------------- device selection
@pytest.mark.parametrize(
    ("pref", "cuda", "mps", "expected"),
    [
        ("auto", True, True, "cuda"),
        ("auto", False, True, "mps"),
        ("auto", False, False, "cpu"),
        ("cpu", True, True, "cpu"),
        ("cuda", True, False, "cuda"),
        ("mps", False, True, "mps"),
    ],
)
def test_resolve_device(pref, cuda, mps, expected):
    assert resolve_device(pref, cuda_available=cuda, mps_available=mps) == expected


@pytest.mark.parametrize(("pref", "cuda", "mps"), [("cuda", False, True), ("mps", True, False), ("tpu", True, True)])
def test_resolve_device_never_silently_switches(pref, cuda, mps):
    with pytest.raises(ModelLoadError):
        resolve_device(pref, cuda_available=cuda, mps_available=mps)


# ---------------------------------------------------------------- identity
def test_model_id_never_contains_filesystem_path(tmp_path: Path):
    adapter = tmp_path / "outputs" / "gemma3-270m-severity-lora" / "best_adapter"
    provider = GemmaSeverityProvider(base_model_id="google/gemma-3-270m-it", adapter_path=adapter)
    assert provider.model_id == "google/gemma-3-270m-it + LoRA:gemma3-270m-severity-lora"
    assert str(tmp_path) not in provider.model_id
    assert provider.is_mock is False
    assert provider.name == "gemma"


def test_adapter_label_uses_leaf_for_custom_names():
    assert adapter_label(Path("/x/y/my-adapter-v2")) == "my-adapter-v2"


# ---------------------------------------------------------------- load failures
def test_missing_adapter_dir_is_unavailable(tmp_path: Path):
    provider = GemmaSeverityProvider(base_model_id="m", adapter_path=tmp_path / "missing")
    provider.start()
    provider.wait_until_settled(10)
    status = provider.status()
    assert status.state.value == "unavailable"
    assert status.model_loaded is False
    assert "missing" not in (status.detail or "")


def test_adapter_dir_without_config_is_unavailable(tmp_path: Path):
    provider = GemmaSeverityProvider(base_model_id="m", adapter_path=tmp_path)
    provider.start()
    provider.wait_until_settled(10)
    status = provider.status()
    assert status.state.value == "unavailable"
    assert "adapter_config.json" in (status.detail or "")


def test_missing_local_base_model_is_unavailable(tmp_path: Path):
    adapter = tmp_path / "adapter"
    adapter.mkdir()
    (adapter / "adapter_config.json").write_text("{}")
    provider = GemmaSeverityProvider(
        base_model_id="google/gemma-3-270m-it", adapter_path=adapter, base_model_path=tmp_path / "no-base"
    )
    provider.start()
    provider.wait_until_settled(10)
    status = provider.status()
    assert status.state.value == "unavailable"
    assert "BASE_MODEL_PATH" in (status.detail or "")
    assert str(tmp_path) not in (status.detail or "")


# ---------------------------------------------------------------- prompt format
def test_user_message_matches_training_layout():
    """train_severity_lora.py: content = instruction + "\\n\\n" + input (single user turn)."""
    message = build_user_message(INCIDENT)
    assert message.startswith(SEVERITY_INSTRUCTION + "\n\n")
    assert INSTRUCTION_SEPARATOR == "\n\n"
    assert "Incident:\n" not in message  # evaluation-script prefix is not used
    messages = build_chat_messages(INCIDENT)
    assert messages == [{"role": "user", "content": message}]


def test_instruction_is_verbatim_from_build_severity_dataset():
    assert SEVERITY_INSTRUCTION.startswith("Classify ONLY the incident severity")
    assert SEVERITY_INSTRUCTION.endswith('using exactly one of P1, P2, P3, or P4.')
    assert 'Return only valid JSON in the form {"severity":"P1"}' in SEVERITY_INSTRUCTION


def test_rendered_incident_uses_training_section_labels():
    text = render_incident_text(INCIDENT)
    assert "Business impact: Employees cannot access business applications." in text
    assert "Diagnostic evidence: Authentication failures reported by affected users." in text
    assert "Scope check: 45 affected users" in text
    assert "Finance, Operations" in text and "Mumbai, Pune" in text
    assert "no workaround is available" in text
    assert "\n" not in text  # training inputs are a single paragraph


@pytest.mark.parametrize(
    ("value", "phrase"),
    [(True, "a workaround is available"), (False, "no workaround is available"),
     (None, "workaround availability is unknown")],
)
def test_workaround_rendering(value, phrase):
    incident = IncidentInput(title="t", description="d", affected_service="s",
                             affected_users=1, business_impact="b", workaround_available=value)
    assert phrase in render_incident_text(incident)


def test_missing_optional_fields_render_explicitly():
    incident = IncidentInput(title="t", description="d", affected_service="s",
                             affected_users=1, business_impact="b")
    text = render_incident_text(incident)
    assert "Diagnostic evidence: not provided." in text
    assert "affected departments: not specified" in text
    assert "1 affected user;" in text


def test_base_configs_without_weights_explain_how_to_download(tmp_path: Path):
    """A fresh git clone has base/config.json but not the weights file."""
    adapter = tmp_path / "adapter"
    adapter.mkdir()
    (adapter / "adapter_config.json").write_text("{}")
    base = tmp_path / "base"
    base.mkdir()
    (base / "config.json").write_text("{}")
    provider = GemmaSeverityProvider(base_model_id="google/gemma-3-270m-it", adapter_path=adapter, base_model_path=base)
    provider.start()
    provider.wait_until_settled(10)
    status = provider.status()
    assert status.state.value == "unavailable"
    assert "scripts/download_model.py" in (status.detail or "")
    assert str(tmp_path) not in (status.detail or "")
