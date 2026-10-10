"""Prompt construction for the Gemma severity LoRA adapter.

Mirrors the training pipeline in ~/AI-Lab/incident_triage_dataset_v3:

* scripts/build_severity_dataset.py defines the instruction (copied verbatim).
* scripts/train_severity_lora.py builds a single user turn as
  ``instruction + "\\n\\n" + row["input"]``, renders it with
  ``tokenizer.apply_chat_template(..., add_generation_prompt=True)`` and
  tokenises with ``add_special_tokens=False`` (the template already emits BOS).

Note: scripts/evaluate_severity_lora.py differs from training in two ways — it
inserts ``"Incident:\\n"`` before the input and tokenises with the default
``add_special_tokens=True`` (double BOS). This module follows the *training*
format. Change INCIDENT_PREFIX below if you decide to match evaluation instead.

The API receives structured fields, whereas training inputs were single
narrative paragraphs ("... Business impact: ... Diagnostic evidence: ...
Scope check: ..."). `render_incident_text` maps the structured request onto that
narrative shape. How well the adapter generalises to this rendering has NOT been
evaluated.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.providers.base import IncidentInput

# Copied verbatim from scripts/build_severity_dataset.py (severity_*_v1.jsonl).
SEVERITY_INSTRUCTION = (
    "Classify ONLY the incident severity using the documented business impact "
    "and confirmed scope. Apply these rules: P1 = critical service unavailable "
    "across multiple departments and at least two sites, with no safe workaround; "
    "P2 = multiple users affected within one department while other departments "
    "remain operational; P3 = one user or endpoint affected while others work "
    "normally; P4 = no material service interruption and low business impact. "
    "Prioritize confirmed business impact and scope over technical symptoms. "
    'Return only valid JSON in the form {"severity":"P1"}, using exactly one '
    "of P1, P2, P3, or P4."
)

INSTRUCTION_SEPARATOR = "\n\n"
INCIDENT_PREFIX = ""  # training used no prefix; evaluation used "Incident:\n"

#: Training examples were truncated-checked at 384 tokens (prompt + answer).
TRAINING_MAX_LENGTH = 384


def _sentence(text: str) -> str:
    text = " ".join(text.split())
    if not text:
        return text
    return text if text[-1] in ".!?" else text + "."


def _join(items: tuple[str, ...]) -> str:
    return ", ".join(items) if items else "not specified"


def render_incident_text(incident: "IncidentInput") -> str:
    """Render structured fields into the narrative layout used in training inputs."""
    if incident.workaround_available is True:
        workaround = "a workaround is available"
    elif incident.workaround_available is False:
        workaround = "no workaround is available"
    else:
        workaround = "workaround availability is unknown"

    users = incident.affected_users
    user_phrase = f"{users} affected user" + ("" if users == 1 else "s")

    parts = [
        _sentence(incident.title),
        _sentence(incident.description),
        _sentence(f"Affected service: {incident.affected_service}"),
        "Business impact: " + _sentence(incident.business_impact),
        "Diagnostic evidence: "
        + (_sentence(incident.diagnostic_evidence) if incident.diagnostic_evidence else "not provided."),
        "Scope check: "
        + _sentence(
            f"{user_phrase}; affected departments: {_join(incident.affected_departments)}; "
            f"affected sites: {_join(incident.affected_sites)}; {workaround}"
        ),
    ]
    return " ".join(p for p in parts if p)


def build_user_message(incident: "IncidentInput") -> str:
    return SEVERITY_INSTRUCTION + INSTRUCTION_SEPARATOR + INCIDENT_PREFIX + render_incident_text(incident)


def build_chat_messages(incident: "IncidentInput") -> list[dict[str, str]]:
    return [{"role": "user", "content": build_user_message(incident)}]


def build_text_chat_messages(incident_text: str) -> list[dict[str, str]]:
    """Free-text narrative (e.g. a queued ticket description) in the exact training
    layout: instruction + "\\n\\n" + input. The text is passed through unchanged
    apart from stripping outer whitespace; nothing else (labels, titles) is added."""
    content = SEVERITY_INSTRUCTION + INSTRUCTION_SEPARATOR + INCIDENT_PREFIX + incident_text.strip()
    return [{"role": "user", "content": content}]
