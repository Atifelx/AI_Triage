import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvaluationView, cellStyle } from "@/components/EvaluationView";
import type { ConfusionColumn, EvaluationResponse, Severity, TicketResult } from "@/lib/types";
import { GEMMA_READY, MOCK_INFERENCE, health, jsonResponse, stubFetch } from "./helpers";
import { renderInShell } from "./render";

const LABELS: Severity[] = ["P1", "P2", "P3", "P4"];

function result(id: string, expected: Severity, predicted: Severity | null, isMock = false): TicketResult {
  return {
    ticket_id: id, title: `Incident ${id}`, request_id: `r-${id}`,
    outcome: predicted ? "predicted" : "invalid_output", predicted_severity: predicted, expected_severity: expected,
    correct: predicted ? predicted === expected : null, provider: isMock ? "mock" : "gemma",
    model_id: isMock ? MOCK_INFERENCE.model_id : GEMMA_READY.model_id, is_mock: isMock,
    inference_ms: predicted ? 350 : null, analyzed_at: "2026-10-10T10:00:00Z",
  };
}

function evaluation(results: TicketResult[], isMock = false): EvaluationResponse {
  const matrix = Object.fromEntries(
    LABELS.map((e) => [e, { P1: 0, P2: 0, P3: 0, P4: 0, invalid: 0 } as Record<ConfusionColumn, number>]),
  ) as EvaluationResponse["confusion_matrix"];
  for (const r of results) matrix[r.expected_severity][r.predicted_severity ?? "invalid"] += 1;
  const correct = results.filter((r) => r.correct).length;
  return {
    provider: isMock ? "mock" : "gemma", model_id: isMock ? MOCK_INFERENCE.model_id : GEMMA_READY.model_id,
    is_mock: isMock, total_tickets: 50, analyzed: results.length, correct,
    invalid_outputs: results.filter((r) => !r.predicted_severity).length,
    accuracy: results.length ? Math.round((correct / results.length) * 10000) / 10000 : null,
    labels: LABELS, confusion_matrix: matrix, results,
  };
}

const serve = (data: EvaluationResponse, inference = GEMMA_READY) =>
  stubFetch({
    health: () => jsonResponse(200, health(inference)),
    tickets: (path) => (path === "/evaluation" ? jsonResponse(200, data) : jsonResponse(404, {})),
  });

describe("EvaluationView", () => {
  it("shows accuracy, the confusion matrix and predicted vs expected rows", async () => {
    serve(evaluation([result("A", "P1", "P1"), result("B", "P1", "P2"), result("C", "P3", "P3")]));
    renderInShell(<EvaluationView />);

    expect(await screen.findByText("66.7%")).toBeInTheDocument();
    expect(screen.getByText("Accuracy")).toBeInTheDocument();
    expect(screen.getByText("MODEL PREDICTION · GEMMA")).toBeInTheDocument();
    expect(screen.queryByText(/not a model evaluation/)).not.toBeInTheDocument();

    const matrix = screen.getByRole("table", { name: /Confusion matrix/ });
    expect(within(matrix).getByLabelText("Expected P1, predicted P1: 1 ticket")).toHaveTextContent("1");
    expect(within(matrix).getByLabelText("Expected P1, predicted P2: 1 ticket")).toBeInTheDocument();
    expect(within(matrix).getByLabelText("Expected P2, predicted P2: 0 tickets")).toHaveTextContent("0");

    const rows = screen.getByRole("region", { name: "Predicted vs expected" });
    expect(within(rows).getAllByText("✓ Match")).toHaveLength(2);
    expect(within(rows).getAllByText("✗ Mismatch")).toHaveLength(1);
  });

  it("counts invalid outputs separately and never as a prediction", async () => {
    serve(evaluation([result("A", "P2", null), result("B", "P2", "P2")]));
    renderInShell(<EvaluationView />);
    const matrix = await screen.findByRole("table", { name: /Confusion matrix/ });
    expect(within(matrix).getByLabelText("Expected P2, predicted invalid output: 1 ticket")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("invalid output")).toBeInTheDocument();
  });

  it("marks mock results as not a model evaluation", async () => {
    serve(evaluation([result("A", "P1", "P4", true)], true), MOCK_INFERENCE);
    renderInShell(<EvaluationView />);
    expect(await screen.findByText("MOCK PROVIDER — this is not a model evaluation")).toBeInTheDocument();
    expect(screen.getByText("Agreement (synthetic)")).toBeInTheDocument();
    expect(screen.queryByText("Accuracy")).not.toBeInTheDocument();
    expect(screen.queryByText(/MODEL PREDICTION/)).not.toBeInTheDocument();
  });

  it("has an empty state before any analysis", async () => {
    serve(evaluation([]));
    renderInShell(<EvaluationView />);
    expect(await screen.findByText("No tickets analyzed in this session yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /Confusion matrix/ })).not.toBeInTheDocument();
  });

  it("shades cells on one ramp and keeps text contrast", () => {
    expect(cellStyle(0, 5)).toEqual({ backgroundColor: "#ffffff", color: "#64748b" });
    expect(cellStyle(5, 5)).toEqual({ backgroundColor: "#184f95", color: "#ffffff" });
    expect(cellStyle(1, 5).color).toBe("#0f172a");
  });
});
