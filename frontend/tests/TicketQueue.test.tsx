import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TicketQueue } from "@/components/TicketQueue";
import type { InferenceHealth, Severity, Ticket, TicketResult } from "@/lib/types";
import { GEMMA_READY, MOCK_INFERENCE, health, jsonResponse, stubFetch } from "./helpers";
import { renderInShell } from "./render";

interface FakeTicket {
  ticket_id: string;
  title: string;
  description: string;
  expected_severity: Severity;
}

const TICKETS: FakeTicket[] = [
  { ticket_id: "T-1", title: "Incident T-1", description: "Everyone offline at two sites.", expected_severity: "P1" },
  { ticket_id: "T-2", title: "Incident T-2", description: "Finance team blocked.", expected_severity: "P2" },
];

/** In-memory stand-in for the backend queue, mirroring its contract. */
function fakeQueue(inference: InferenceHealth, opts: { predict?: Severity; invalid?: boolean; inferenceMs?: number } = {}) {
  let issued = 0;
  const results = new Map<string, TicketResult>();
  const toTicket = (t: FakeTicket, i: number): Ticket => ({
    ticket_id: t.ticket_id, title: t.title, description: t.description, position: i + 1, total: TICKETS.length,
  });
  const calls: string[] = [];
  const handler = (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/next") {
      if (issued >= TICKETS.length) {
        return jsonResponse(200, { ticket: null, exhausted: true, issued, total: TICKETS.length,
          message: `End of queue: all ${TICKETS.length} tickets have been issued in this session.` });
      }
      issued += 1;
      return jsonResponse(200, { ticket: toTicket(TICKETS[issued - 1], issued - 1), exhausted: false, issued, total: TICKETS.length, message: null });
    }
    if (path === "/session") {
      const current = issued ? toTicket(TICKETS[issued - 1], issued - 1) : null;
      return jsonResponse(200, { total: TICKETS.length, issued, analyzed: results.size, exhausted: issued >= TICKETS.length,
        current, current_analysis: current ? results.get(current.ticket_id) ?? null : null });
    }
    const match = path.match(/^\/(.+)\/analyze$/);
    if (match) {
      const t = TICKETS.find((x) => x.ticket_id === match[1])!;
      if (opts.invalid) {
        return jsonResponse(502, { error: { code: "invalid_model_output", message: "The model returned an invalid severity output. No prediction was made.", request_id: "r-bad" } });
      }
      const severity = opts.predict ?? "P1";
      const now = "2026-10-10T10:00:00Z";
      results.set(t.ticket_id, {
        ticket_id: t.ticket_id, title: t.title, request_id: "r1", outcome: "predicted", predicted_severity: severity,
        expected_severity: t.expected_severity, correct: severity === t.expected_severity, provider: inference.provider,
        model_id: inference.model_id, is_mock: inference.is_mock, inference_ms: opts.inferenceMs ?? 350, analyzed_at: now,
      });
      return jsonResponse(200, {
        request_id: "r1", ticket_id: t.ticket_id, incident_title: t.title, severity, human_review_required: true,
        provider: inference.provider, model_id: inference.model_id, is_mock: inference.is_mock,
        inference_ms: opts.inferenceMs ?? 350, created_at: now, expected_severity: t.expected_severity,
        correct: severity === t.expected_severity,
      });
    }
    return jsonResponse(404, { error: { code: "not_found", message: "Not found" } });
  };
  return { handler, calls };
}

const analyzeButton = () => screen.getByRole("button", { name: /^(Analyze|Analyzing…|Analyzed)$/ });
const nextButton = () => screen.getByRole("button", { name: /Next Ticket|Loading…/ });

describe("TicketQueue", () => {
  it("shows one ticket, analyzes it with the real-model labelling, and hides the label until after inference", async () => {
    const user = userEvent.setup();
    const queue = fakeQueue(GEMMA_READY, { predict: "P2", inferenceMs: 352.4 });
    stubFetch({ health: () => jsonResponse(200, health(GEMMA_READY)), tickets: queue.handler });
    renderInShell(<TicketQueue />);

    expect(await screen.findByText("Ticket 1 of 2")).toBeInTheDocument();
    expect(screen.getByText(TICKETS[0].description)).toBeInTheDocument();
    expect(screen.queryByText(/Expected/)).not.toBeInTheDocument(); // label hidden pre-inference
    await waitFor(() => expect(analyzeButton()).toBeEnabled());

    await user.click(analyzeButton());

    const analysis = screen.getByRole("region", { name: "Analysis" });
    expect(await within(analysis).findByText("MODEL PREDICTION · GEMMA")).toBeInTheDocument();
    expect(within(analysis).getByText("High")).toBeInTheDocument(); // P2 — High
    expect(within(analysis).getByText("352 ms")).toBeInTheDocument();
    expect(within(analysis).getByText("✗ Mismatch")).toBeInTheDocument();
    expect(within(analysis).queryByText("MOCK RESULT")).not.toBeInTheDocument();
    expect(analyzeButton()).toBeDisabled();
    expect(queue.calls).toContain("POST /T-1/analyze");
  });

  it("labels mock results as synthetic, never as model predictions", async () => {
    const user = userEvent.setup();
    const queue = fakeQueue(MOCK_INFERENCE, { predict: "P1" });
    stubFetch({ health: () => jsonResponse(200, health(MOCK_INFERENCE)), tickets: queue.handler });
    renderInShell(<TicketQueue />);
    await screen.findByText("Ticket 1 of 2");
    await waitFor(() => expect(analyzeButton()).toBeEnabled());
    await user.click(analyzeButton());

    const analysis = screen.getByRole("region", { name: "Analysis" });
    expect(await within(analysis).findByText("MOCK RESULT")).toBeInTheDocument();
    expect(within(analysis).getByText(/It is not a model\s+prediction/)).toBeInTheDocument();
    expect(within(analysis).queryByText(/MODEL PREDICTION/)).not.toBeInTheDocument();
  });

  it("advances without reuse and shows a clear end-of-queue message", async () => {
    const user = userEvent.setup();
    const queue = fakeQueue(MOCK_INFERENCE);
    stubFetch({ health: () => jsonResponse(200, health(MOCK_INFERENCE)), tickets: queue.handler });
    renderInShell(<TicketQueue />);
    await screen.findByText("Ticket 1 of 2");

    await user.click(nextButton());
    expect(await screen.findByText("Ticket 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Not analyzed yet.", { exact: false })).toBeInTheDocument();

    await user.click(nextButton());
    expect(await screen.findByRole("heading", { name: "End of queue" })).toBeInTheDocument();
    expect(screen.getByText(/all 2 tickets have been issued/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analyze" })).not.toBeInTheDocument();
    expect(queue.calls.filter((c) => c === "GET /next")).toHaveLength(3);
  });

  it("restores the current ticket and its analysis without advancing the queue", async () => {
    const queue = fakeQueue(GEMMA_READY, { predict: "P1" });
    // Simulate a previous page load: ticket 1 issued and analyzed.
    await queue.handler("/next", { method: "GET" });
    await queue.handler("/T-1/analyze", { method: "POST" });
    queue.calls.length = 0;
    stubFetch({ health: () => jsonResponse(200, health(GEMMA_READY)), tickets: queue.handler });
    renderInShell(<TicketQueue />);

    expect(await screen.findByText("Ticket 1 of 2")).toBeInTheDocument();
    expect(await screen.findByText("✓ Match")).toBeInTheDocument();
    expect(queue.calls).not.toContain("GET /next");
  });

  it("blocks analysis while the model is loading", async () => {
    const loading: InferenceHealth = { ...GEMMA_READY, state: "loading", ready: false, model_loaded: false };
    const queue = fakeQueue(loading);
    stubFetch({ health: () => jsonResponse(200, health(loading)), tickets: queue.handler });
    renderInShell(<TicketQueue />);
    await screen.findByText("Ticket 1 of 2");
    await screen.findByText(/Model is loading/);
    expect(analyzeButton()).toBeDisabled();
  });

  it("reports invalid model output without inventing a prediction", async () => {
    const user = userEvent.setup();
    const queue = fakeQueue(GEMMA_READY, { invalid: true });
    stubFetch({ health: () => jsonResponse(200, health(GEMMA_READY)), tickets: queue.handler });
    renderInShell(<TicketQueue />);
    await screen.findByText("Ticket 1 of 2");
    await waitFor(() => expect(analyzeButton()).toBeEnabled());
    await user.click(analyzeButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Model returned invalid output");
    expect(alert).toHaveTextContent("Recorded as an invalid output in the evaluation");
    expect(screen.queryByText("Critical")).not.toBeInTheDocument();
  });
});
