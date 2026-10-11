"""Prompt profiles for the full (five-field) incident-triage LoRA adapters.

A LoRA adapter only learns the prompt layout it was trained on, so each profile
reproduces one training script exactly. Selected by TRIAGE_PROMPT_FORMAT.

* ``v3`` — training/scripts/train_lora_resumable.py (adapter
  backend/models/gemma3-270m-triage-v3). User turn = ``instruction +
  "\\n\\nIncident:\\n" + input``; chat template with ``add_generation_prompt=True``;
  tokenised with ``add_special_tokens=False``. Target is a compact JSON object
  with keys category, severity, root_cause, evidence, recommended_actions,
  human_review_required (always true in the data).
* ``incident_lora`` — ~/Downloads/incident_triage_dataset/train_incident_lora.py
  (adapter "incident-lora"). Instruction and incident in one user turn; target
  has exactly the five keys.

The prompts are copied verbatim. In particular they are NOT extended with extra
instructions (e.g. "state your uncertainty"): the adapters were never trained on
such text, and changing the prompt changes what the model sees. Uncertainty is
instead derived after parsing (see app/services/triage_parser.py).

The API receives structured fields; `render_incident_text` (shared with the
severity adapter) maps them onto the narrative layout of the training inputs.
How well the adapters generalise to free-form, hand-written incidents has NOT
been evaluated.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.services.providers.gemma_prompt import render_incident_text

TriagePromptFormat = Literal["v3", "incident_lora"]

REQUIRED_TRIAGE_KEYS: tuple[str, ...] = (
    "category",
    "severity",
    "root_cause",
    "evidence",
    "recommended_actions",
)


@dataclass(frozen=True)
class RootCause:
    category: str
    label: str
    definition: str = ""


@dataclass(frozen=True)
class TriageProfile:
    name: TriagePromptFormat
    instruction: str
    incident_prefix: str
    categories: tuple[str, ...]
    #: Known root causes (taxonomy). None -> the training data has no published taxonomy.
    root_causes: dict[str, RootCause] | None
    #: Keys the adapter may emit besides the five required ones.
    optional_keys: tuple[str, ...]
    #: Max tokens (prompt + answer) used when the adapter was trained.
    training_max_length: int

    def build_user_message(self, incident_text: str) -> str:
        return self.instruction + self.incident_prefix + incident_text.strip()

    def build_chat_messages(self, incident_text: str) -> list[dict[str, str]]:
        return [{"role": "user", "content": self.build_user_message(incident_text)}]


# --- v3 ----------------------------------------------------------------------
# Instruction copied verbatim from training/data/incident_*_v3.jsonl (identical in
# every row; written by training/scripts/generate_dataset.py).
V3_INSTRUCTION = (
    "Triage the IT incident. Return exactly one JSON object with keys category, severity, "
    "root_cause, evidence, recommended_actions, human_review_required. Use only the supplied "
    "category and root_cause taxonomy. Severity must be P1, P2, P3, or P4 and must match the "
    "explicit impact and scope evidence. Evidence must be grounded in the ticket. "
    "Recommendations must be safe and specific. Keep human review required; do not claim "
    "that an action was executed or invent facts."
)

# Copied from training/docs/taxonomy.json (category, label, definition).
V3_ROOT_CAUSES: dict[str, RootCause] = {
    "invalid_credentials": RootCause("authentication", "Invalid credentials or stale cached password", "The account or client is submitting a credential that is no longer valid."),
    "account_locked": RootCause("authentication", "Account lockout", "Repeated failed sign-ins have triggered account lockout."),
    "mfa_registration_missing": RootCause("identity", "MFA registration missing", "The required multi-factor authentication method is not registered."),
    "oauth_consent_missing": RootCause("identity", "OAuth consent not granted", "An application lacks approved consent for the permissions it requests."),
    "device_noncompliant": RootCause("conditional_access", "Device compliance requirement failed", "A Conditional Access policy blocks access because one or more devices are noncompliant."),
    "policy_scope_mismatch": RootCause("conditional_access", "Conditional Access policy scope mismatch", "A policy assignment or exclusion does not match the intended user or group scope."),
    "disk_space_exhausted": RootCause("endpoint", "Endpoint disk space exhausted", "Insufficient free disk space prevents an application or operating-system operation."),
    "print_queue_stuck": RootCause("endpoint", "Print queue stalled", "A stuck spooler job or queue prevents printing."),
    "stale_compliance_sync": RootCause("device_compliance", "Stale compliance state", "The management service has not received a recent device compliance check-in."),
    "enrollment_profile_mismatch": RootCause("device_compliance", "Enrollment profile mismatch", "The device was enrolled with a profile that does not match the intended deployment."),
    "mailbox_quota_exceeded": RootCause("exchange", "Mailbox quota exceeded", "Mailbox storage has reached its configured quota."),
    "outlook_profile_corrupt": RootCause("exchange", "Corrupt Outlook profile", "A local Outlook profile or cache is damaged and prevents normal startup or synchronization."),
    "site_permission_missing": RootCause("sharepoint", "SharePoint permission missing", "The user does not have the required permission on the target site or library."),
    "storage_limit_reached": RootCause("sharepoint", "SharePoint storage limit reached", "The site or tenant storage limit prevents new content from being uploaded."),
    "audio_device_unavailable": RootCause("teams", "Teams audio device unavailable", "The selected microphone or speaker is unavailable to the application."),
    "guest_identity_mismatch": RootCause("teams", "Guest identity mismatch", "The guest is signing in with an identity different from the invited identity."),
    "proxy_configuration_invalid": RootCause("network", "Invalid proxy configuration", "A proxy setting or authentication issue blocks access to required services."),
    "dns_resolution_failure": RootCause("network", "DNS resolution failure", "The endpoint cannot resolve a service hostname through its configured DNS path."),
    "suspicious_signin_detected": RootCause("security", "Suspicious sign-in", "Sign-in telemetry indicates a risky or anomalous sign-in requiring security review."),
    "legacy_auth_blocked": RootCause("security", "Legacy authentication blocked", "A client uses a legacy authentication protocol that is blocked by policy."),
}

V3_PROFILE = TriageProfile(
    name="v3",
    instruction=V3_INSTRUCTION,
    incident_prefix="\n\nIncident:\n",
    categories=(
        "authentication",
        "conditional_access",
        "device_compliance",
        "endpoint",
        "exchange",
        "identity",
        "network",
        "security",
        "sharepoint",
        "teams",
    ),
    root_causes=V3_ROOT_CAUSES,
    optional_keys=("human_review_required",),
    training_max_length=384,
)

# --- incident-lora -------------------------------------------------------------
# Copied verbatim from build_messages() in train_incident_lora.py.
_INCIDENT_LORA_CATEGORIES = (
    "authentication, conditional_access, device_compliance, exchange, "
    "sharepoint, teams, endpoint, network, identity, security, service_outage, other"
)
INCIDENT_LORA_INSTRUCTION = (
    "You are an enterprise IT incident triage assistant. Analyze the incident using only "
    "the provided evidence. Return only one valid JSON object with exactly these keys: "
    "category, severity, root_cause, evidence, recommended_actions. "
    f"category must be one of: {_INCIDENT_LORA_CATEGORIES}. "
    "severity must be P1, P2, P3, or P4. "
    "evidence must be an array of short strings supported by the incident. "
    "recommended_actions must be an array of safe, practical next steps. "
    "Do not invent evidence. Do not claim an action has already been completed.\n\n"
)

INCIDENT_LORA_PROFILE = TriageProfile(
    name="incident_lora",
    instruction=INCIDENT_LORA_INSTRUCTION,
    incident_prefix="Incident:\n",
    categories=tuple(c.strip() for c in _INCIDENT_LORA_CATEGORIES.split(",")),
    root_causes=None,
    optional_keys=(),
    training_max_length=512,
)

PROFILES: dict[str, TriageProfile] = {p.name: p for p in (V3_PROFILE, INCIDENT_LORA_PROFILE)}


def get_profile(name: str) -> TriageProfile:
    try:
        return PROFILES[name]
    except KeyError:
        raise ValueError(f"Unknown TRIAGE_PROMPT_FORMAT: {name!r}") from None


__all__ = [
    "INCIDENT_LORA_PROFILE",
    "PROFILES",
    "REQUIRED_TRIAGE_KEYS",
    "RootCause",
    "TriageProfile",
    "TriagePromptFormat",
    "V3_PROFILE",
    "get_profile",
    "render_incident_text",
]
