"""Turn a held-out v3 dataset row into the manual-triage form fields.

Rows are single narratives in the training layout:
  "<narrative>. Business impact: <..>. Diagnostic evidence: <..>. Scope check: <..>. Additional context: <..>"

The narrative, impact, evidence, scope check and context are copied VERBATIM. The form's
numeric/list fields (users, departments, sites, workaround) are derived from the scope-check
and impact sentences only: never from the row's labels. Title and service come from the
narrative text.
"""

from __future__ import annotations

import re
from typing import Any

ROW = re.compile(
    r"^(?P<narrative>.*?)\. Business impact: (?P<impact>.*?)\. Diagnostic evidence: (?P<evidence>.*?)\.?"
    r"\. Scope check: (?P<scope>.*?)\. Additional context: (?P<context>.*?)\.?$"
)

# "<service> is failing on" / "<service> stopped working on" / "opened for <service> for a"
SERVICE = re.compile(
    r"(?:: |reports that |reported that |that )(?P<a>[^:;]+?) (?:is failing|stopped working|is unavailable)"
    r"|opened for (?P<b>.+?) for an? "
)
# "at the <site>:" / "at the <site> reports" / "at the <site>;"
SITE = re.compile(r" at (?:the )?(?P<site>[A-Z]?[\w\- ]+?(?:office|branch|network|floor|workspace|site|campus|centre|center|hub))\b")

ROLE_DEPARTMENT = {
    "finance analyst": "Finance",
    "hr specialist": "Human Resources",
    "executive assistant": "Executive Office",
    "support agent": "Service Desk",
    "security analyst": "Security",
    "new starter": "Operations",
    "sales manager": "Sales",
    "project manager": "PMO",
    "developer": "Engineering",
    "nurse": "Clinical",
}


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def department_for(narrative: str) -> str:
    low = narrative.lower()
    for role, dept in ROLE_DEPARTMENT.items():
        if role in low:
            return dept
    return "Operations"


def scope_fields(scope: str, impact: str, site: str, department: str) -> dict[str, Any]:
    """Structured scope consistent with the scope-check sentence (not with any label)."""
    s, i = scope.lower(), impact.lower()
    if "no safe workaround" in s or "no safe workaround" in i:
        workaround: bool | None = False
    elif "workaround" in i:
        workaround = True
    else:
        workaround = None
    if "multiple departments" in s:
        other_site = "Head Office" if site != "Head Office" else "Regional Office"
        other_dept = "Operations" if department != "Operations" else "Finance"
        return {"users": 180, "departments": [department, other_dept], "sites": [site, other_site], "workaround": workaround}
    if "multiple affected users in one department" in s:
        return {"users": 14, "departments": [department], "sites": [site], "workaround": workaround}
    if "one affected user" in s:
        return {"users": 1, "departments": [department], "sites": [site], "workaround": workaround}
    # "no material service interruption"
    return {"users": 1, "departments": [], "sites": [site], "workaround": True if workaround is None else workaround}


def form_fields(row: dict[str, Any]) -> dict[str, Any]:
    m = ROW.match(row["input"])
    if not m:
        raise ValueError(f"unexpected layout in {row['id']}")
    narrative = m["narrative"].strip()
    sm = SERVICE.search(narrative)
    service = (sm["a"] or sm["b"]).strip() if sm else "IT service"
    site_m = SITE.search(narrative)
    site = site_m["site"].strip() if site_m else "Head Office"
    department = department_for(narrative)
    scope = scope_fields(m["scope"], m["impact"], _cap(site), department)
    return {
        "source_id": row["id"],
        "title": f"{_cap(service)} failing — {_cap(site)}",
        "description": narrative + ".",
        "affected_service": _cap(service),
        "affected_users": scope["users"],
        "affected_departments": scope["departments"],
        "affected_sites": scope["sites"],
        "business_impact": _cap(m["impact"].strip()) + ".",
        "workaround_available": scope["workaround"],
        "diagnostic_evidence": m["evidence"].strip().rstrip(".") + ".",
        "scope_check": m["scope"].strip() + ".",
        "additional_context": m["context"].strip().rstrip(".") + ".",
    }
