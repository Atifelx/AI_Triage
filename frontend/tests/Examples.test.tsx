import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { Dashboard } from "@/components/Dashboard";
import { ReviewQueue } from "@/components/ReviewQueue";
import { TicketQueue } from "@/components/TicketQueue";
import { ExampleDeck, resetExampleDeck } from "@/lib/examples";
import type { Example, FullTriageResponse, InferenceHealth } from "@/lib/types";
import { GEMMA_READY, health, jsonResponse } from "./helpers";

const WITH_TRIAGE: InferenceHealth = {
  ...GEMMA_READY,
  triage: { available: true, adapter: "gemma3-270m-triage-v3", model_id: "google/gemma-3-270m-it + LoRA:gemma3-270m-triage-v3", prompt_format: "v3", detail: "Triage adapter loaded." },
};

function example(i: number): Example {
  return {
    source_id: `ITSM-09-0${i}`,
    title: `Device management failing — Site ${i}`,
    description: `A ticket was opened for device management at site ${i}.`,
    affected_service: "Device management",
    affected_users: 14,
    affected_departments: ["Operations"],
    affected_sites: [`Site ${i}`],
    business_impact: "Multiple users in one department are blocked.",
    workaround_available: true,
    diagnostic_evidence: "Devices report a stale compliance state.",
    scope_check: "The service desk confirmed multiple affected users in one department; other departments remain operational.",
    additional_context: "The issue has not been reproduced on an unrelated endpoint.",
    reference: { severity: "P2", category: "device_compliance", root_cause: "stale_compliance_sync" },
  };
}

function triage(overrides: Partial<FullTriageResponse> = {}): FullTriageResponse {
  return {
    request_id: "req-1", incident_title: "Device management failing — Site 1",
    severity: "P2", severity_source: "severity_adapter", triage_severity: "P3",
    incident_text: "A ticket was opened for device management at site 1. Diagnostic evidence: Devices report a stale compliance state.",
    analysis: { category: "device_compliance", severity: "P3", root_cause: "stale_compliance_sync", evidence: ["Devices report a stale compliance state."], recommended_actions: ["Trigger a supported management sync."] },
    root_cause: { id: "stale_compliance_sync", label: "Stale compliance state", definition: "The device compliance record is out of date.", in_taxonomy: true, taxonomy_category: "device_compliance", matches_category: true },
    evidence_support: [{ text: "Devices report a stale compliance state.", found_in_incident: true }],
    severity_check: { severity: "P2", model_id: "google/gemma-3-270m-it + LoRA:gemma3-270m-severity", agrees: false },
    uncertain: true, uncertainty_notes: ["The dedicated severity adapter predicts P2, not P3. Confirm the severity manually."],
    human_review_required: true, provider: "gemma", model_id: "google/gemma-3-270m-it + LoRA:gemma3-270m-triage-v3",
    adapter: "gemma3-270m-triage-v3", prompt_format: "v3", is_mock: false, inference_ms: 1500, created_at: "2026-10-11T10:00:00Z",
    ...overrides,
  };
}

function stub(routes: Record<string, (init?: RequestInit) => Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [suffix, h] of Object.entries(routes)) if (url.endsWith(suffix)) return h(init);
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => resetExampleDeck());
afterEach(() => vi.unstubAllGlobals());

describe("ExampleDeck", () => {
  it("deals every example once before any repeat", () => {
    const deck = new ExampleDeck(Array.from({ length: 50 }, (_, i) => example(i)));
    const first = Array.from({ length: 50 }, () => deck.next().example.source_id);
    expect(new Set(first).size).toBe(50);
    expect(deck.next().dealt).toBe(1); // reshuffled after a full pass
  });
});

describe("Manual triage with held-out examples", () => {
  it("loads unique examples and checks the result against the dataset label", async () => {
    const sent: unknown[] = [];
    stub({
      "/health": () => jsonResponse(200, health(WITH_TRIAGE)),
      "/api/v1/examples": () => jsonResponse(200, { source: "held-out", examples: [example(1), example(2)] }),
      "/api/v1/triage/full": (init) => {
        sent.push(JSON.parse(String(init?.body)));
        return jsonResponse(200, triage());
      },
    });
    const user = userEvent.setup();
    render(<AppShell><Dashboard /></AppShell>);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Full triage" })).toHaveAttribute("aria-checked", "true"));

    await user.click(screen.getByRole("button", { name: "Load example" }));
    const firstTitle = (await screen.findByText(/Example 1 of 2/)).textContent;
    const title1 = (screen.getByLabelText(/Incident title/) as HTMLInputElement).value;
    await user.click(screen.getByRole("button", { name: "Load example" }));
    await screen.findByText(/Example 2 of 2/);
    expect((screen.getByLabelText(/Incident title/) as HTMLInputElement).value).not.toBe(title1);
    expect(firstTitle).toMatch(/held-out data/);
    expect(screen.getByLabelText(/Scope check/)).toHaveValue(example(1).scope_check);

    await user.click(screen.getByRole("button", { name: /Analyze incident/ }));
    const check = await screen.findByRole("region", { name: "Reference check" });
    // Labels never go to the model.
    expect(JSON.stringify(sent[0])).not.toMatch(/reference|stale_compliance_sync|device_compliance/);
    expect(sent[0]).toMatchObject({ scope_check: expect.stringContaining("one department") });
    const sevRow = within(check).getByText("Severity").closest("tr")!;
    expect(sevRow).toHaveTextContent("Match"); // severity adapter's P2 equals the reference
    expect(sevRow).not.toHaveTextContent("Mismatch");
    const catRow = within(check).getByText("Category").closest("tr")!;
    expect(catRow).toHaveTextContent("Match");
    expect(within(screen.getByRole("list", { name: "Severity scale" })).getByText("Reference").closest("li")).toHaveTextContent("P2");
  });

  it("drops the reference once the engineer edits the example", async () => {
    stub({
      "/health": () => jsonResponse(200, health(WITH_TRIAGE)),
      "/api/v1/examples": () => jsonResponse(200, { source: "held-out", examples: [example(1)] }),
      "/api/v1/triage/full": () => jsonResponse(200, triage()),
    });
    const user = userEvent.setup();
    render(<AppShell><Dashboard /></AppShell>);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Full triage" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Load example" }));
    await screen.findByText(/Example 1 of 1/);
    await user.type(screen.getByLabelText(/Incident title/), " (edited)");
    await user.click(screen.getByRole("button", { name: /Analyze incident/ }));
    await screen.findByRole("region", { name: "Root Cause Analysis" });
    expect(screen.queryByRole("region", { name: "Reference check" })).not.toBeInTheDocument();
  });
});

describe("Ticket queue full analysis", () => {
  it("analyzes a queued ticket in full mode and checks all three labels", async () => {
    const incident = { ...example(1), workaround_available: true };
    const ticket = {
      ticket_id: "ITSM-01-001", title: "Device management failing — Site 1", description: "A ticket was opened…", position: 1, total: 120,
      incident: {
        title: incident.title, description: incident.description, affected_service: incident.affected_service,
        affected_users: incident.affected_users, affected_departments: incident.affected_departments, affected_sites: incident.affected_sites,
        business_impact: incident.business_impact, workaround_available: true, diagnostic_evidence: incident.diagnostic_evidence,
      },
    };
    let issued = 0;
    const calls: string[] = [];
    stub({
      "/health": () => jsonResponse(200, health(WITH_TRIAGE)),
      "/api/v1/tickets/session": () => jsonResponse(200, { total: 120, issued, analyzed: 0, exhausted: false, current: issued ? ticket : null, current_analysis: null }),
      "/api/v1/tickets/next": () => {
        issued = 1;
        return jsonResponse(200, { ticket, exhausted: false, issued: 1, total: 120, message: null });
      },
      "/analyze/full": () => {
        calls.push("full");
        return jsonResponse(200, {
          ticket_id: ticket.ticket_id, triage: triage({ incident_title: ticket.title }), expected_severity: "P2",
          expected_category: "device_compliance", expected_root_cause: "stale_compliance_sync",
          severity_correct: false, category_correct: true, root_cause_correct: true,
        });
      },
    });
    const user = userEvent.setup();
    render(
      <AppShell>
        <TicketQueue />
        <ReviewQueue />
      </AppShell>,
    );
    await screen.findByText(ticket.title, { selector: "h3" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "Full triage" })).toHaveAttribute("aria-checked", "true"));
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByRole("region", { name: "Root Cause Analysis" })).toBeInTheDocument();
    expect(calls).toEqual(["full"]);
    const check = screen.getByRole("region", { name: "Reference check" });
    expect(within(check).getByText(/ticket ITSM-01-001/)).toBeInTheDocument();
    expect(within(check).getByText("Root cause").closest("tr")).toHaveTextContent("Match");

    // Analyzed queue tickets land in Reviews automatically, tagged with their source.
    expect(screen.getByText("Added to Reviews as REV-1042 (pending review).")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /Review queue/ })).getByText(/Ticket queue · ITSM-01-001/)).toBeInTheDocument();

    // Optional: choose a specific review destination for the same ticket.
    await user.click(screen.getByRole("button", { name: "Send for Review" }));
    const dialog = screen.getByRole("dialog", { name: "Route Incident for Human Review" });
    expect(within(dialog).getByLabelText("Priority")).toHaveValue("P2"); // severity in use
    await user.click(within(dialog).getByRole("radio", { name: /ServiceNow/ }));
    await user.click(within(dialog).getByRole("button", { name: "Submit for Review" }));
    expect(screen.getByText(/Review ticket REV-1042 sent to IT Incident Review Queue \(ServiceNow\)/)).toBeInTheDocument();
    const row = within(screen.getByRole("region", { name: /Review queue/ })).getByText("REV-1042").closest("li")!;
    expect(row).toHaveTextContent(ticket.title);
    expect(row).toHaveTextContent("Device management");
  });
});
