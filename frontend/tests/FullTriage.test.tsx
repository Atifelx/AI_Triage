import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { Dashboard } from "@/components/Dashboard";
import { ACTIONS_NOTICE } from "@/components/FullTriageResult";
import { ReviewQueue } from "@/components/ReviewQueue";
import { TriageEvaluation } from "@/components/TriageEvaluation";
import { API_BASE_URL } from "@/lib/api";
import type { FullTriageResponse, InferenceHealth } from "@/lib/types";
import { GEMMA_READY, health, jsonResponse } from "./helpers";

const GEMMA_WITH_TRIAGE: InferenceHealth = {
  ...GEMMA_READY,
  triage: {
    available: true,
    adapter: "gemma3-270m-triage-v3",
    model_id: "google/gemma-3-270m-it + LoRA:gemma3-270m-triage-v3",
    prompt_format: "v3",
    detail: "Triage adapter loaded.",
  },
};

function fullResult(overrides: Partial<FullTriageResponse> = {}): FullTriageResponse {
  return {
    request_id: "req-full-1",
    incident_title: "Microsoft 365 sign-in failures",
    severity: "P1",
    severity_source: "severity_adapter",
    triage_severity: "P2",
    analysis: {
      category: "authentication",
      severity: "P2",
      root_cause: "invalid_credentials",
      evidence: ["Authentication failures reported by affected users.", "Token service rejected refresh tokens."],
      recommended_actions: ["Review identity provider health", "Inspect sign-in logs and error codes"],
    },
    root_cause: {
      id: "invalid_credentials",
      label: "Invalid credentials or stale cached password",
      in_taxonomy: true,
      taxonomy_category: "authentication",
      matches_category: true,
    },
    evidence_support: [
      { text: "Authentication failures reported by affected users.", found_in_incident: true },
      { text: "Token service rejected refresh tokens.", found_in_incident: false },
    ],
    severity_check: { severity: "P1", model_id: "google/gemma-3-270m-it + LoRA:gemma3-270m-severity", agrees: false },
    uncertain: true,
    uncertainty_notes: ["The dedicated severity adapter predicts P1, not P2. Confirm the severity manually."],
    human_review_required: true,
    provider: "gemma",
    model_id: "google/gemma-3-270m-it + LoRA:gemma3-270m-triage-v3",
    adapter: "gemma3-270m-triage-v3",
    prompt_format: "v3",
    is_mock: false,
    inference_ms: 2310.5,
    created_at: "2026-10-11T10:00:00Z",
    raw_output: null,
    ...overrides,
  };
}

type Route = (init?: RequestInit) => Response;

function stub(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [suffix, handler] of Object.entries(routes)) if (url.endsWith(suffix)) return handler(init);
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const VALUES = {
  title: "Microsoft 365 sign-in failures",
  description: "Multiple employees cannot sign in.",
  service: "Microsoft 365",
  users: "45",
  impact: "Employees cannot access business applications.",
};

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  // The first sample matches VALUES.
  await user.click(screen.getByRole("button", { name: "Load example" }));
    await screen.findByDisplayValue("Microsoft 365 sign-in failures");
  await user.click(screen.getByRole("button", { name: /Analyze incident/ }));
}

afterEach(() => vi.unstubAllGlobals());

describe("Full incident triage", () => {
  it("defaults to full triage and renders all five fields from the API response", async () => {
    const response = fullResult();
    const fetchMock = stub({
      "/health": () => jsonResponse(200, health(GEMMA_WITH_TRIAGE)),
      "/api/v1/triage/full": () => jsonResponse(200, response),
    });
    const user = userEvent.setup();
    render(<AppShell><Dashboard /></AppShell>);

    await waitFor(() => expect(screen.getByRole("radio", { name: "Full triage" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByText(/full triage: google\/gemma-3-270m-it \+ LoRA:gemma3-270m-triage-v3/)).toBeInTheDocument();
    await fillAndSubmit(user);

    expect(await screen.findByText("Root Cause Analysis")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/api/v1/triage/full"))).toBe(true);
    const panel = screen.getByRole("region", { name: "Triage result" });
    // Severity in use comes from the severity adapter (P1); the triage adapter's own answer is P2.
    expect(within(panel).getAllByText("Critical").length).toBeGreaterThan(0);
    expect(within(panel).getByText("authentication")).toBeInTheDocument();
    expect(within(panel).getByText("Invalid credentials or stale cached password")).toBeInTheDocument();
    expect(within(panel).getByText("Stated in incident")).toBeInTheDocument();
    expect(within(panel).getByText("Model inference")).toBeInTheDocument();
    expect(within(panel).getByText(ACTIONS_NOTICE)).toBeInTheDocument();
    expect(within(panel).getByText("Review identity provider health")).toBeInTheDocument();
    expect(within(panel).getByText(/Severity from the dedicated severity adapter/)).toBeInTheDocument();
    expect(within(panel).getByText(/The triage adapter alone suggested P2/)).toBeInTheDocument();
    const ladder = within(panel).getByRole("list", { name: "Severity scale" });
    expect(ladder.querySelector('[aria-current="true"]')).toHaveTextContent("P1");
    expect(within(ladder).getByText("Triage adapter").closest("li")).toHaveTextContent("P2");
    expect(within(panel).getByText(/Treat this analysis as uncertain/)).toBeInTheDocument();
    expect(within(panel).getByText(response.model_id)).toBeInTheDocument();

    // Checking an action is local state only: no extra request is made.
    const callsBefore = fetchMock.mock.calls.length;
    await user.click(within(panel).getByRole("checkbox", { name: "Mark action 1 as reviewed" }));
    expect(within(panel).getByText("1 of 2 reviewed")).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);

    // Raw JSON is the actual analysis object.
    await user.click(within(panel).getByText("View Raw JSON"));
    const pre = panel.querySelector("details pre");
    expect(JSON.parse(pre?.textContent ?? "")).toEqual(response.analysis);
  });

  it("shows invalid model output safely, with raw output when the backend exposes it", async () => {
    stub({
      "/health": () => jsonResponse(200, health(GEMMA_WITH_TRIAGE)),
      "/api/v1/triage/full": () =>
        jsonResponse(502, {
          error: {
            code: "invalid_model_output",
            message: "The model returned an invalid triage output. No analysis was made.",
            request_id: "r9",
            raw_output: '{"category":"print"',
          },
        }),
    });
    const user = userEvent.setup();
    render(<AppShell><Dashboard /></AppShell>);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Full triage" })).toBeEnabled());
    await fillAndSubmit(user);
    expect(await screen.findByText("Model returned invalid output")).toBeInTheDocument();
    expect(screen.queryByText("Root Cause Analysis")).not.toBeInTheDocument();
    expect(screen.getByText('{"category":"print"')).toBeInTheDocument();
  });

  it("falls back to severity-only when no triage adapter is loaded", async () => {
    stub({
      "/health": () =>
        jsonResponse(200, health({ ...GEMMA_READY, triage: { available: false, adapter: null, model_id: null, prompt_format: null, detail: "No incident-triage adapter configured." } })),
    });
    render(<AppShell><Dashboard /></AppShell>);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Full triage" })).toBeDisabled());
    expect(screen.getByRole("radio", { name: "Severity only" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Full triage unavailable: No incident-triage adapter configured/)).toBeInTheDocument();
  });

  it("routes a result for review, then through approval to the owning team's systems", async () => {
    const dispatchBodies: unknown[] = [];
    const route = {
      team: {
        key: "iam", name: "Identity & Access Management", slack_channel: "#iam-ops", teams_channel: "Identity & Access › Incidents",
        jira_project: "IAM", servicenow_group: "IAM - L2", crm_queue: "IT Service Management Queue", categories: ["authentication"],
      },
      severity: "P1", connectors: ["servicenow", "slack"], owner_reason: "Category 'authentication' is owned by Identity & Access Management.",
      severity_reason: "P1 is a major incident.",
    };
    const deliveries = [
      { connector: "servicenow", connector_name: "ServiceNow", action: "Create incident", target: "IAM - L2", method: "POST",
        endpoint: "https://acmeit.service-now.com/api/now/table/incident",
        payload: { short_description: "Microsoft 365 sign-in failures", assignment_group: "IAM - L2", impact: "1", urgency: "1", business_service: "Microsoft 365", contact_type: "integration", work_notes: "AI triage" } },
      { connector: "slack", connector_name: "Slack", action: "Post message", target: "#major-incidents", method: "POST",
        endpoint: "https://slack.com/api/chat.postMessage",
        payload: { channel: "#major-incidents", text: "<!here> [P1] Microsoft 365 sign-in failures", blocks: [{ type: "header", text: { type: "plain_text", text: "P1 · Microsoft 365 sign-in failures" } }] } },
    ];
    const fetchMock = stub({
      "/health": () => jsonResponse(200, health(GEMMA_WITH_TRIAGE)),
      "/api/v1/triage/full": () => jsonResponse(200, fullResult()),
      "/api/v1/dispatch/preview": (init) => {
        dispatchBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse(200, { mode: "sandbox", route, deliveries });
      },
      "/api/v1/dispatch": (init) => {
        dispatchBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse(200, {
          dispatch_id: "DSP-00001", review_ticket_id: "REV-1042", mode: "sandbox", created_at: "2026-10-11T10:05:00Z", route,
          results: deliveries.map((d, i) => ({
            ...d,
            receipt: { status: "delivered", mode: "sandbox", external_ref: i === 0 ? "INC0010042" : "ts 1.0 in #major-incidents", detail: "Recorded in the sandbox outbox." },
          })),
        });
      },
    });
    const user = userEvent.setup();
    render(
      <AppShell>
        <Dashboard />
        <ReviewQueue />
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByRole("radio", { name: "Full triage" })).toBeEnabled());
    await fillAndSubmit(user);
    // Every full analysis lands in Reviews automatically, before anyone clicks a button.
    expect(await screen.findByText("Added to Reviews as REV-1042 (pending review).")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /Review queue/ })).getByText("REV-1042")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Send for Review" }));

    const dialog = screen.getByRole("dialog", { name: "Route Incident for Human Review" });
    expect(within(dialog).queryByText(/mock/i)).not.toBeInTheDocument();
    expect(within(dialog).getAllByText("Sandbox")).toHaveLength(4);
    expect(within(dialog).getByLabelText("Priority")).toHaveValue("P1"); // prefilled from the severity in use

    await user.click(within(dialog).getByRole("button", { name: "Submit for Review" }));
    expect(within(dialog).getByText("Choose a destination.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("radio", { name: /Microsoft Teams/ }));
    await user.selectOptions(within(dialog).getByLabelText(/Team or queue/), "Incident Review Team");
    await user.click(within(dialog).getByRole("button", { name: "Preview Ticket" }));
    const preview = within(dialog).getByRole("article", { name: "Ticket REV-1042" });
    expect(within(preview).getByText(VALUES.title)).toBeInTheDocument();
    expect(within(preview).getByText("Invalid credentials or stale cached password")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Submit for Review" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Review ticket REV-1042 sent to Incident Review Team (Microsoft Teams).")).toBeInTheDocument();
    const recent = screen.getByRole("region", { name: "Recent activity" });
    expect(within(recent).getByText("Review ticket REV-1042 → Incident Review Team")).toBeInTheDocument();

    // Review queue: open, start review, approve with a severity override, route.
    const queue = screen.getByRole("region", { name: /Review queue/ });
    const row = within(queue).getByText("REV-1042").closest("li")!;
    expect(within(row).getByText("Pending Review")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Open" }));
    await user.click(within(queue).getByRole("button", { name: "Start review" }));
    await user.click(within(queue).getByRole("button", { name: "Approve" }));
    expect(within(queue).getByText("Enter the reviewer's name.")).toBeInTheDocument();
    await user.type(within(queue).getByLabelText("Reviewer"), "Priya Raman");
    await user.selectOptions(within(queue).getByLabelText("Final severity"), "P1");
    await user.click(within(queue).getByRole("button", { name: "Approve" }));

    expect(await within(queue).findByText("Routing plan")).toBeInTheDocument();
    expect(within(queue).getByText(/owned by Identity & Access Management/)).toBeInTheDocument();
    expect(within(queue).getByText("P1 · Microsoft 365 sign-in failures")).toBeInTheDocument(); // Slack preview
    expect(dispatchBodies[0]).toMatchObject({ review_ticket_id: "REV-1042", approved_severity: "P1", reviewer: "Priya Raman" });

    await user.click(within(queue).getByRole("checkbox", { name: "Send to Slack (#major-incidents)" }));
    await user.click(within(queue).getByRole("button", { name: /Route to Identity & Access Management \(1 system\)/ }));
    expect(await within(queue).findByText("INC0010042")).toBeInTheDocument();
    expect(dispatchBodies[1]).toMatchObject({ connectors: ["servicenow"] });
    expect(within(row).getByText("With team")).toBeInTheDocument();

    // Every request went to the triage API; nothing else was contacted.
    for (const [url] of fetchMock.mock.calls) expect(String(url).startsWith(API_BASE_URL)).toBe(true);
  });

  it("explains the root cause with its definition and highlights the proof in the ticket", async () => {
    stub({
      "/health": () => jsonResponse(200, health(GEMMA_WITH_TRIAGE)),
      "/api/v1/triage/full": () =>
        jsonResponse(
          200,
          fullResult({
            incident_text: "Microsoft 365 sign-in failures. Diagnostic evidence: Authentication failures reported by affected users.",
            root_cause: { ...fullResult().root_cause, definition: "The account or client is submitting a credential that is no longer valid." },
          }),
        ),
    });
    const user = userEvent.setup();
    render(<AppShell><Dashboard /></AppShell>);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Full triage" })).toBeEnabled());
    await fillAndSubmit(user);
    const rca = await screen.findByRole("region", { name: "Root Cause Analysis" });
    expect(within(rca).getByText("Why this root cause?")).toBeInTheDocument();
    expect(within(rca).getByText(/submitting a credential that is no longer valid/)).toBeInTheDocument();
    await user.click(within(rca).getByText("Show where the proof appears in the ticket"));
    const mark = rca.querySelector("mark");
    expect(mark?.textContent?.toLowerCase()).toBe("authentication failures reported by affected users");
  });
});

describe("TriageEvaluation", () => {
  it("shows shipped metrics and marks unmeasured ones", async () => {
    const m = (correct: number) => ({ correct, total: 100, accuracy: correct / 100 });
    stub({
      "/api/v1/triage/evaluation": () =>
        jsonResponse(200, {
          available: true,
          adapter: "gemma3-270m-triage-v3",
          detail: "Measured offline.",
          source: "backend/models/gemma3-270m-triage-v3/evaluation_metrics.json",
          base_model: { valid_json: m(99), category: m(1), severity: m(7), root_cause: m(0) },
          fine_tuned: { valid_json: m(100), category: m(100), severity: m(43), root_cause: m(100) },
          not_measured: ["Evidence quality / support (no labelled evaluation exists)"],
        }),
    });
    render(<TriageEvaluation />);
    const row = (await screen.findByText("Severity exact match")).closest("tr")!;
    expect(within(row).getByText("7.0%")).toBeInTheDocument();
    expect(within(row).getByText("43.0%")).toBeInTheDocument();
    expect(screen.getByText("Evidence quality / support")).toBeInTheDocument();
    expect(screen.getByText(/Not measured/)).toBeInTheDocument();
  });

  it("shows an unavailable state instead of numbers", async () => {
    stub({
      "/api/v1/triage/evaluation": () =>
        jsonResponse(200, { available: false, adapter: null, detail: "No incident-triage adapter is configured.", source: null, base_model: null, fine_tuned: null, not_measured: [] }),
    });
    render(<TriageEvaluation />);
    expect(await screen.findByText(/Unavailable: No incident-triage adapter is configured/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
