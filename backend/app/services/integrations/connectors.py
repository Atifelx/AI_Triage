"""Connectors for Slack, Microsoft Teams, Jira, ServiceNow and a CRM (Salesforce).

Each connector builds the exact request body its vendor API expects. In SANDBOX mode
(the only mode implemented) `deliver` records the request instead of sending it and
returns a sandbox reference; no network call is made and no credential is read.
Going live means implementing `deliver` with an HTTP client and the env vars in
`go_live`; the payloads do not change.
"""

from __future__ import annotations

import itertools
import time
import uuid
from dataclasses import dataclass
from typing import Any

from app.services.integrations.routing import MAJOR_INCIDENT_SLACK, MAJOR_INCIDENT_TEAMS, RoutePlan

SEVERITY_LABEL = {"P1": "Critical", "P2": "High", "P3": "Medium", "P4": "Low"}


@dataclass(frozen=True)
class DispatchContext:
    """Everything a connector may put in a message. Built from a human-approved review ticket."""

    review_ticket_id: str
    title: str
    incident_text: str
    affected_service: str
    affected_users: int
    category: str
    ai_severity: str
    approved_severity: str
    root_cause: str
    root_cause_label: str
    evidence: tuple[str, ...]
    recommended_actions: tuple[str, ...]
    reviewer: str
    review_notes: str
    model_id: str
    route: RoutePlan


@dataclass(frozen=True)
class Delivery:
    connector: str
    connector_name: str
    action: str
    target: str
    method: str
    endpoint: str
    payload: dict[str, Any]


@dataclass(frozen=True)
class Receipt:
    status: str
    mode: str
    external_ref: str
    detail: str


@dataclass
class Workspace:
    """Where live calls would go. Shown in endpoints; never contacted in sandbox mode."""

    slack_workspace: str = "acme-it"
    jira_site: str = "acme-it.atlassian.net"
    servicenow_instance: str = "acmeit.service-now.com"
    salesforce_instance: str = "acme-it.my.salesforce.com"


def _sev(ctx: DispatchContext) -> str:
    return f"{ctx.approved_severity} — {SEVERITY_LABEL[ctx.approved_severity]}"


def _approval_line(ctx: DispatchContext) -> str:
    override = (
        f" (AI suggested {ctx.ai_severity})" if ctx.ai_severity != ctx.approved_severity else ""
    )
    return f"Approved by {ctx.reviewer} · review {ctx.review_ticket_id} · severity {ctx.approved_severity}{override}"


class Connector:
    id: str
    name: str
    vendor_api: str
    go_live: dict[str, Any]

    def __init__(self, workspace: Workspace) -> None:
        self.ws = workspace
        self._counter = itertools.count(self.first_ref)

    first_ref = 1

    def build(self, ctx: DispatchContext) -> list[Delivery]:
        raise NotImplementedError

    def sandbox_ref(self, delivery: Delivery) -> str:
        raise NotImplementedError

    def deliver(self, delivery: Delivery) -> Receipt:
        """SANDBOX: record only. A live implementation would POST `delivery.payload`."""
        return Receipt(
            status="delivered",
            mode="sandbox",
            external_ref=self.sandbox_ref(delivery),
            detail=f"Recorded in the sandbox outbox; not sent to {self.name}.",
        )


class SlackConnector(Connector):
    id = "slack"
    name = "Slack"
    vendor_api = "Web API chat.postMessage"
    go_live = {
        "steps": [
            "Create a Slack app at api.slack.com/apps and add the bot scopes chat:write and chat:write.public.",
            "Install the app to your workspace and copy the Bot User OAuth Token.",
            "Invite the bot to each team channel and #major-incidents.",
        ],
        "env": ["SLACK_BOT_TOKEN"],
    }

    def _message(self, ctx: DispatchContext, channel: str, mention: bool) -> dict[str, Any]:
        proof = "\n".join(f"• {e}" for e in ctx.evidence[:3]) or "_No evidence returned_"
        prefix = "<!here> " if mention else ""
        return {
            "channel": channel,
            "text": f"{prefix}[{ctx.approved_severity}] {ctx.title} — assigned to {ctx.route.team.name}",
            "blocks": [
                {"type": "header", "text": {"type": "plain_text", "text": f"{ctx.approved_severity} · {ctx.title}"}},
                {
                    "type": "section",
                    "fields": [
                        {"type": "mrkdwn", "text": f"*Severity*\n{_sev(ctx)}"},
                        {"type": "mrkdwn", "text": f"*Owner*\n{ctx.route.team.name}"},
                        {"type": "mrkdwn", "text": f"*Service*\n{ctx.affected_service} · {ctx.affected_users} users"},
                        {"type": "mrkdwn", "text": f"*Root cause (AI)*\n{ctx.root_cause_label}"},
                    ],
                },
                {"type": "section", "text": {"type": "mrkdwn", "text": f"*Proof*\n{proof}"}},
                {"type": "context", "elements": [{"type": "mrkdwn", "text": _approval_line(ctx)}]},
                {
                    "type": "actions",
                    "elements": [
                        {"type": "button", "style": "primary", "action_id": "incident_ack",
                         "text": {"type": "plain_text", "text": "Acknowledge"}, "value": ctx.review_ticket_id},
                        {"type": "button", "action_id": "incident_open",
                         "text": {"type": "plain_text", "text": "Open incident"}, "value": ctx.review_ticket_id},
                    ],
                },
            ],
        }

    def build(self, ctx: DispatchContext) -> list[Delivery]:
        channels = [(ctx.route.team.slack_channel, False)]
        if ctx.approved_severity == "P1":
            channels.insert(0, (MAJOR_INCIDENT_SLACK, True))
        return [
            Delivery(
                connector=self.id,
                connector_name=self.name,
                action="Post message",
                target=channel,
                method="POST",
                endpoint="https://slack.com/api/chat.postMessage",
                payload=self._message(ctx, channel, mention),
            )
            for channel, mention in channels
        ]

    def sandbox_ref(self, delivery: Delivery) -> str:
        return f"ts {time.time():.6f} in {delivery.target}"


class TeamsConnector(Connector):
    id = "teams"
    name = "Microsoft Teams"
    vendor_api = "Workflows webhook (Adaptive Card)"
    go_live = {
        "steps": [
            "In the target Teams channel open Workflows and add 'Post to a channel when a webhook request is received'.",
            "Copy the workflow URL it generates.",
        ],
        "env": ["TEAMS_WORKFLOW_URL"],
    }

    def build(self, ctx: DispatchContext) -> list[Delivery]:
        card = {
            "type": "AdaptiveCard",
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            "version": "1.4",
            "body": [
                {"type": "TextBlock", "size": "Large", "weight": "Bolder", "color": "Attention",
                 "text": f"{ctx.approved_severity} major incident: {ctx.title}", "wrap": True},
                {"type": "FactSet", "facts": [
                    {"title": "Severity", "value": _sev(ctx)},
                    {"title": "Owner", "value": ctx.route.team.name},
                    {"title": "Service", "value": f"{ctx.affected_service} ({ctx.affected_users} users)"},
                    {"title": "Root cause (AI)", "value": ctx.root_cause_label},
                ]},
                {"type": "TextBlock", "text": "Proof", "weight": "Bolder"},
                *({"type": "TextBlock", "text": f"• {e}", "wrap": True, "spacing": "None"} for e in ctx.evidence[:3]),
                {"type": "TextBlock", "text": _approval_line(ctx), "isSubtle": True, "size": "Small", "wrap": True},
            ],
            "actions": [{"type": "Action.OpenUrl", "title": "Join bridge", "url": "https://teams.microsoft.com/"}],
        }
        return [
            Delivery(
                connector=self.id,
                connector_name=self.name,
                action="Post Adaptive Card",
                target=MAJOR_INCIDENT_TEAMS,
                method="POST",
                endpoint="${TEAMS_WORKFLOW_URL}",
                payload={
                    "type": "message",
                    "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": card}],
                },
            )
        ]

    def sandbox_ref(self, delivery: Delivery) -> str:
        return f"message {uuid.uuid4().hex[:12]}"


class JiraConnector(Connector):
    id = "jira"
    name = "Jira Service Management"
    vendor_api = "REST API v3 · create issue"
    first_ref = 141
    go_live = {
        "steps": [
            "Create an API token for a service account at id.atlassian.com.",
            "Make sure each team project key exists and has the 'Incident' issue type.",
        ],
        "env": ["JIRA_SITE", "JIRA_EMAIL", "JIRA_API_TOKEN"],
    }
    PRIORITY = {"P1": "Highest", "P2": "High", "P3": "Medium", "P4": "Low"}

    def build(self, ctx: DispatchContext) -> list[Delivery]:
        def para(text: str, bold: bool = False) -> dict[str, Any]:
            node: dict[str, Any] = {"type": "text", "text": text}
            if bold:
                node["marks"] = [{"type": "strong"}]
            return {"type": "paragraph", "content": [node]}

        def items(kind: str, values: tuple[str, ...]) -> dict[str, Any]:
            return {"type": kind, "content": [{"type": "listItem", "content": [para(v)]} for v in values]}

        description = {
            "type": "doc",
            "version": 1,
            "content": [
                para(ctx.incident_text),
                para(f"Root cause (AI): {ctx.root_cause_label}", bold=True),
                para("Proof", bold=True),
                items("bulletList", ctx.evidence),
                para("Recommended actions (AI — require authorization)", bold=True),
                items("orderedList", ctx.recommended_actions),
                para(_approval_line(ctx)),
            ],
        }
        return [
            Delivery(
                connector=self.id,
                connector_name=self.name,
                action="Create issue",
                target=f"Project {ctx.route.team.jira_project}",
                method="POST",
                endpoint=f"https://{self.ws.jira_site}/rest/api/3/issue",
                payload={
                    "fields": {
                        "project": {"key": ctx.route.team.jira_project},
                        "issuetype": {"name": "Incident"},
                        "summary": f"[{ctx.approved_severity}] {ctx.title}",
                        "priority": {"name": self.PRIORITY[ctx.approved_severity]},
                        "labels": ["ai-triage", ctx.category, ctx.root_cause],
                        "description": description,
                    }
                },
            )
        ]

    def sandbox_ref(self, delivery: Delivery) -> str:
        return f"{delivery.payload['fields']['project']['key']}-{next(self._counter)}"


class ServiceNowConnector(Connector):
    id = "servicenow"
    name = "ServiceNow"
    vendor_api = "Table API · incident"
    first_ref = 10042
    go_live = {
        "steps": [
            "Create an integration user with the itil role (or an OAuth API client).",
            "Make sure each assignment group exists on the instance.",
        ],
        "env": ["SERVICENOW_INSTANCE", "SERVICENOW_CLIENT_ID", "SERVICENOW_CLIENT_SECRET"],
    }
    # Impact/urgency pairs that the default priority matrix maps to P1..P4.
    MATRIX = {"P1": ("1", "1"), "P2": ("1", "2"), "P3": ("2", "2"), "P4": ("2", "3")}

    def build(self, ctx: DispatchContext) -> list[Delivery]:
        impact, urgency = self.MATRIX[ctx.approved_severity]
        notes = "\n".join(
            [
                f"AI triage ({ctx.model_id}): category {ctx.category}, root cause {ctx.root_cause_label}.",
                "Proof:",
                *(f"- {e}" for e in ctx.evidence),
                "Recommended actions (AI, require authorization):",
                *(f"{i}. {a}" for i, a in enumerate(ctx.recommended_actions, 1)),
                _approval_line(ctx),
                *([f"Reviewer notes: {ctx.review_notes}"] if ctx.review_notes else []),
            ]
        )
        return [
            Delivery(
                connector=self.id,
                connector_name=self.name,
                action="Create incident",
                target=ctx.route.team.servicenow_group,
                method="POST",
                endpoint=f"https://{self.ws.servicenow_instance}/api/now/table/incident",
                payload={
                    "short_description": ctx.title,
                    "description": ctx.incident_text,
                    "impact": impact,
                    "urgency": urgency,
                    "assignment_group": ctx.route.team.servicenow_group,
                    "business_service": ctx.affected_service,
                    "contact_type": "integration",
                    "work_notes": notes,
                },
            )
        ]

    def sandbox_ref(self, delivery: Delivery) -> str:
        return f"INC{next(self._counter):07d}"


class CrmConnector(Connector):
    id = "crm"
    name = "CRM (Salesforce Service Cloud)"
    vendor_api = "REST API · sObject Case"
    first_ref = 1042
    go_live = {
        "steps": [
            "Create a Connected App with the OAuth client-credentials flow and the api scope.",
            "Assign it a run-as integration user that can create Cases.",
        ],
        "env": ["SALESFORCE_INSTANCE", "SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET"],
    }

    def build(self, ctx: DispatchContext) -> list[Delivery]:
        return [
            Delivery(
                connector=self.id,
                connector_name=self.name,
                action="Create case",
                target=ctx.route.team.crm_queue,
                method="POST",
                endpoint=f"https://{self.ws.salesforce_instance}/services/data/v61.0/sobjects/Case",
                payload={
                    "Subject": f"[{ctx.approved_severity}] {ctx.title}",
                    "Description": f"{ctx.incident_text}\n\n{_approval_line(ctx)}",
                    "Priority": "High" if ctx.approved_severity in ("P1", "P2") else "Medium",
                    "Status": "New",
                    "Origin": "AI Triage",
                    "Type": "Incident",
                },
            )
        ]

    def sandbox_ref(self, delivery: Delivery) -> str:
        return f"Case {next(self._counter):08d}"


CONNECTOR_TYPES: tuple[type[Connector], ...] = (
    ServiceNowConnector,
    JiraConnector,
    SlackConnector,
    TeamsConnector,
    CrmConnector,
)


def build_connectors(workspace: Workspace | None = None) -> dict[str, Connector]:
    ws = workspace or Workspace()
    return {cls.id: cls(ws) for cls in CONNECTOR_TYPES}


__all__ = [
    "CONNECTOR_TYPES",
    "Connector",
    "Delivery",
    "DispatchContext",
    "Receipt",
    "Workspace",
    "build_connectors",
]
