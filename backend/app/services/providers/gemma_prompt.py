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
narrative shape; see its docstring for the measured effect.
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


# Scope-check sentences used verbatim in the training data, one per severity policy.
SCOPE_MULTI_SITE = (
    "Service desk correlation confirms the same failure across multiple departments and at least two sites; "
    "no safe workaround is available"
)
SCOPE_ONE_DEPARTMENT = (
    "The service desk confirmed multiple affected users in one department; other departments remain operational"
)
SCOPE_ONE_USER = (
    "The service desk confirmed one affected user or endpoint and verified that other users are working normally"
)
SCOPE_NO_INTERRUPTION = (
    "Triage confirms no material service interruption; core functionality remains available and the request is low impact"
)


def derive_scope_check(incident: "IncidentInput") -> str:
    """Scope sentence from the structured scope fields, in the training phrasing where it
    is literally true; otherwise a plain factual sentence."""
    users = incident.affected_users
    departments = len(incident.affected_departments)
    sites = len(incident.affected_sites)
    if departments >= 2 and sites >= 2 and incident.workaround_available is False:
        return SCOPE_MULTI_SITE
    if users > 1 and departments <= 1:
        return SCOPE_ONE_DEPARTMENT
    if users == 1:
        return SCOPE_ONE_USER
    if users == 0:
        return SCOPE_NO_INTERRUPTION
    workaround = {True: "a workaround is available", False: "no workaround is available", None: "workaround availability is unknown"}[
        incident.workaround_available
    ]
    return (
        f"The service desk confirmed {users} affected users across {departments} departments and {sites} sites; {workaround}"
    )


def render_incident_text(incident: "IncidentInput") -> str:
    """Render structured fields into the single-paragraph layout of the training inputs:

    "<description>. Business impact: <..>. Diagnostic evidence: <..>. Scope check: <..>.
     Additional context: <..>."

    The title is not part of the prompt (training inputs had none); the affected service is
    added only when the description does not already name it. A trial on held-out rows
    (scripts/trial_form_rendering.py) measured this layout at the same accuracy as the
    original training text, while the earlier "title + service + counts" rendering cut
    severity-adapter accuracy from 100% to 53%.
    """
    description = _sentence(incident.description)
    if incident.affected_service and incident.affected_service.lower() not in description.lower():
        description += " " + _sentence(f"Affected service: {incident.affected_service}")
    parts = [
        description,
        "Business impact: " + _sentence(incident.business_impact),
        "Diagnostic evidence: "
        + (_sentence(incident.diagnostic_evidence) if incident.diagnostic_evidence else "not provided."),
        "Scope check: " + _sentence(incident.scope_check or derive_scope_check(incident)),
    ]
    if incident.additional_context:
        parts.append("Additional context: " + _sentence(incident.additional_context))
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
