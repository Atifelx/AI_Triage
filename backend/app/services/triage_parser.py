"""Parsing, validation and post-hoc assessment of full incident-triage output.

`parse_triage_output` turns raw generated text into a `TriageAnalysis` or raises
InvalidModelOutputError. It never fills in, repairs or guesses a field: the only
leniency is locating the JSON object when the model wraps it in a code fence or
stray text.

`assess_triage` adds checks the adapters were never trained to perform
themselves (they cannot express uncertainty): whether the root cause is in the
training taxonomy and consistent with the category, whether each evidence item
actually appears in the submitted incident, and whether the dedicated severity
adapter agrees. A syntactically valid answer is not assumed to be correct.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from app.services.errors import InvalidModelOutputError
from app.services.severity_parser import SEVERITIES, Severity

if TYPE_CHECKING:
    from app.services.providers.gemma_triage_prompt import TriageProfile

MAX_LIST_ITEMS = 20
MAX_ITEM_CHARS = 1000
MAX_ROOT_CAUSE_CHARS = 120

_INVALID_MESSAGE = "The model returned an invalid triage output. No analysis was made."
_FENCE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.S)


@dataclass(frozen=True)
class TriageAnalysis:
    category: str
    severity: Severity
    root_cause: str
    evidence: tuple[str, ...]
    recommended_actions: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "category": self.category,
            "severity": self.severity,
            "root_cause": self.root_cause,
            "evidence": list(self.evidence),
            "recommended_actions": list(self.recommended_actions),
        }


def _invalid(detail: str, raw: str) -> InvalidModelOutputError:
    return InvalidModelOutputError(_INVALID_MESSAGE, internal_detail=detail, raw_output=raw)


def _load_object(raw: str) -> dict[str, object]:
    text = raw.strip()
    if not text:
        raise _invalid("empty output", raw)
    fenced = _FENCE.match(text)
    if fenced:
        text = fenced.group(1)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        # Locate a single object inside surrounding text; anything else is invalid.
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise _invalid(f"not valid JSON: {text[:200]!r}", raw) from None
        try:
            value = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            raise _invalid(f"not valid JSON: {text[:200]!r}", raw) from None
    if not isinstance(value, dict):
        raise _invalid(f"JSON is not an object: {text[:200]!r}", raw)
    return value


def _string_list(value: object, name: str, raw: str) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise _invalid(f"{name} is not an array", raw)
    if len(value) > MAX_LIST_ITEMS:
        raise _invalid(f"{name} has {len(value)} items (max {MAX_LIST_ITEMS})", raw)
    items: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise _invalid(f"{name} contains a non-string or empty item", raw)
        if len(item) > MAX_ITEM_CHARS:
            raise _invalid(f"{name} item longer than {MAX_ITEM_CHARS} characters", raw)
        items.append(item.strip())
    return tuple(items)


def parse_triage_output(raw: str, profile: "TriageProfile") -> TriageAnalysis:
    """Validate raw generated text against the five-field contract of `profile`."""
    from app.services.providers.gemma_triage_prompt import REQUIRED_TRIAGE_KEYS

    if not isinstance(raw, str):
        raise _invalid(f"non-string output: {type(raw).__name__}", str(raw))
    data = _load_object(raw)

    missing = [k for k in REQUIRED_TRIAGE_KEYS if k not in data]
    if missing:
        raise _invalid(f"missing fields {missing!r}", raw)
    unexpected = sorted(set(data) - set(REQUIRED_TRIAGE_KEYS) - set(profile.optional_keys))
    if unexpected:
        raise _invalid(f"unexpected fields {unexpected!r}", raw)

    severity = data["severity"]
    if severity not in SEVERITIES:
        raise _invalid(f"invalid severity {severity!r}", raw)

    category = data["category"]
    if not isinstance(category, str) or category not in profile.categories:
        raise _invalid(f"category {category!r} is not in the allowed list", raw)

    root_cause = data["root_cause"]
    if not isinstance(root_cause, str) or not root_cause.strip() or len(root_cause) > MAX_ROOT_CAUSE_CHARS:
        raise _invalid(f"invalid root_cause {root_cause!r}", raw)

    if "human_review_required" in data and not isinstance(data["human_review_required"], bool):
        raise _invalid("human_review_required is not a boolean", raw)

    return TriageAnalysis(
        category=category,
        severity=severity,  # type: ignore[arg-type]
        root_cause=root_cause.strip(),
        evidence=_string_list(data["evidence"], "evidence", raw),
        recommended_actions=_string_list(data["recommended_actions"], "recommended_actions", raw),
    )


# ---------------------------------------------------------------- assessment

_WORD = re.compile(r"[a-z0-9]+")


def _words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def evidence_found_in(evidence: str, incident_text: str) -> bool:
    """True when the evidence item is stated in the incident text.

    Exact (normalised) containment, or at least 80% of its words occurring in the
    incident. A False result means the item is the model's own inference.
    """
    ev_words = _words(evidence)
    if not ev_words:
        return False
    incident_words = _words(incident_text)
    if " ".join(ev_words) in " ".join(incident_words):
        return True
    vocabulary = set(incident_words)
    hits = sum(1 for w in ev_words if w in vocabulary)
    return hits / len(ev_words) >= 0.8


@dataclass(frozen=True)
class RootCauseAssessment:
    label: str | None
    definition: str | None
    in_taxonomy: bool | None  # None -> the adapter has no published taxonomy
    taxonomy_category: str | None
    matches_category: bool | None


@dataclass(frozen=True)
class TriageAssessment:
    root_cause: RootCauseAssessment
    evidence_found: tuple[bool, ...]
    notes: tuple[str, ...] = field(default_factory=tuple)

    @property
    def uncertain(self) -> bool:
        return bool(self.notes)


def assess_triage(
    analysis: TriageAnalysis,
    profile: "TriageProfile",
    *,
    incident_text: str,
    diagnostic_evidence_supplied: bool,
    severity_check: Severity | None,
) -> TriageAssessment:
    notes: list[str] = []

    if profile.root_causes is None:
        root = RootCauseAssessment(label=None, definition=None, in_taxonomy=None, taxonomy_category=None, matches_category=None)
        notes.append("This adapter has no published root-cause taxonomy, so the root cause was not validated.")
    else:
        known = profile.root_causes.get(analysis.root_cause)
        if known is None:
            root = RootCauseAssessment(label=None, definition=None, in_taxonomy=False, taxonomy_category=None, matches_category=None)
            notes.append("The predicted root cause is not in the training taxonomy; treat it as unverified.")
        else:
            matches = known.category == analysis.category
            root = RootCauseAssessment(
                label=known.label,
                definition=known.definition or None,
                in_taxonomy=True,
                taxonomy_category=known.category,
                matches_category=matches,
            )
            if not matches:
                notes.append(
                    f"The predicted root cause belongs to category '{known.category}', not the predicted "
                    f"category '{analysis.category}'. The analysis is internally inconsistent."
                )

    if not diagnostic_evidence_supplied:
        notes.append(
            "No diagnostic evidence was supplied, so the root cause is a hypothesis based on the description only."
        )

    found = tuple(evidence_found_in(item, incident_text) for item in analysis.evidence)
    if not analysis.evidence:
        notes.append("The model returned no evidence for its analysis.")
    elif not all(found):
        missing = found.count(False)
        notes.append(
            f"{missing} evidence item{'s' if missing != 1 else ''} not found in the submitted incident: "
            "model inference, not a supplied fact."
        )

    if severity_check is not None and severity_check != analysis.severity:
        notes.append(
            f"The dedicated severity adapter predicts {severity_check}, not {analysis.severity}. "
            "Confirm the severity manually."
        )

    return TriageAssessment(root_cause=root, evidence_found=found, notes=tuple(notes))
