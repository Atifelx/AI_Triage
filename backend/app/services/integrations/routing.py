"""Routing rules: who owns an approved incident, and which systems hear about it.

Owner is decided by the AI category (confirmed by the reviewer); fan-out is decided by the
APPROVED severity (the reviewer may override the AI suggestion). The severity rules follow
the policy in training/docs/taxonomy.json:

* P1 — major incident: ServiceNow record, Jira incident, Slack #major-incidents (@here) and
  the team channel, Teams major-incident bridge, CRM case for stakeholder updates.
* P2 — prompt service-owner coordination: ServiceNow, Jira, Slack team channel, CRM case.
* P3 — standard support: ServiceNow, Jira.
* P4 — low impact: ServiceNow only.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.services.severity_parser import Severity


@dataclass(frozen=True)
class Team:
    key: str
    name: str
    slack_channel: str
    teams_channel: str
    jira_project: str
    servicenow_group: str
    crm_queue: str
    categories: tuple[str, ...] = field(default_factory=tuple)


TEAMS: tuple[Team, ...] = (
    Team(
        key="iam",
        name="Identity & Access Management",
        slack_channel="#iam-ops",
        teams_channel="Identity & Access › Incidents",
        jira_project="IAM",
        servicenow_group="IAM - L2",
        crm_queue="IT Service Management Queue",
        categories=("authentication", "identity", "conditional_access"),
    ),
    Team(
        key="euc",
        name="End-User Computing",
        slack_channel="#euc-support",
        teams_channel="End-User Computing › Incidents",
        jira_project="EUC",
        servicenow_group="EUC - Desktop Support",
        crm_queue="IT Service Management Queue",
        categories=("endpoint", "device_compliance"),
    ),
    Team(
        key="collab",
        name="Collaboration Services (Microsoft 365)",
        slack_channel="#m365-collab",
        teams_channel="Collaboration Services › Incidents",
        jira_project="COLLAB",
        servicenow_group="M365 - Collaboration",
        crm_queue="IT Service Management Queue",
        categories=("exchange", "sharepoint", "teams"),
    ),
    Team(
        key="netops",
        name="Network Operations",
        slack_channel="#netops",
        teams_channel="Network Operations › Incidents",
        jira_project="NET",
        servicenow_group="Network - L2",
        crm_queue="IT Service Management Queue",
        categories=("network",),
    ),
    Team(
        key="soc",
        name="Security Operations (SOC)",
        slack_channel="#soc-alerts",
        teams_channel="Security Operations › Triage",
        jira_project="SEC",
        servicenow_group="SOC - Tier 2",
        crm_queue="Escalations Queue",
        categories=("security",),
    ),
)

SERVICE_DESK = Team(
    key="servicedesk",
    name="Service Desk L2",
    slack_channel="#servicedesk",
    teams_channel="Service Desk › Escalations",
    jira_project="ITSD",
    servicenow_group="Service Desk - L2",
    crm_queue="IT Service Management Queue",
)

MAJOR_INCIDENT_SLACK = "#major-incidents"
MAJOR_INCIDENT_TEAMS = "IT Operations › Major Incident Bridge"

#: Connectors notified per approved severity (order = display order).
SEVERITY_FANOUT: dict[str, tuple[str, ...]] = {
    "P1": ("servicenow", "jira", "slack", "teams", "crm"),
    "P2": ("servicenow", "jira", "slack", "crm"),
    "P3": ("servicenow", "jira"),
    "P4": ("servicenow",),
}

SEVERITY_REASON: dict[str, str] = {
    "P1": "P1 is a major incident: record in ServiceNow, open a Jira incident, page #major-incidents and "
    "the owning team, open the Teams bridge and start a CRM case for stakeholder updates.",
    "P2": "P2 needs prompt service-owner coordination: record in ServiceNow, open a Jira incident, notify "
    "the owning team's Slack channel and open a CRM case.",
    "P3": "P3 is standard support: record in ServiceNow and queue a Jira ticket for the owning team; no chat paging.",
    "P4": "P4 is low impact: record in ServiceNow only.",
}


def owner_for(category: str) -> Team:
    for team in TEAMS:
        if category in team.categories:
            return team
    return SERVICE_DESK


@dataclass(frozen=True)
class RoutePlan:
    team: Team
    severity: Severity
    connectors: tuple[str, ...]
    owner_reason: str
    severity_reason: str


def plan_route(category: str, severity: Severity) -> RoutePlan:
    team = owner_for(category)
    owner_reason = (
        f"Category '{category}' is owned by {team.name}."
        if team is not SERVICE_DESK
        else f"No team owns category '{category}'; routed to {team.name}."
    )
    return RoutePlan(
        team=team,
        severity=severity,
        connectors=SEVERITY_FANOUT[severity],
        owner_reason=owner_reason,
        severity_reason=SEVERITY_REASON[severity],
    )
