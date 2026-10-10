import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResultPanel } from "@/components/ResultPanel";
import { ApiError } from "@/lib/api";
import { GEMMA_READY, triageResult } from "./helpers";

describe("ResultPanel", () => {
  it("labels mock results prominently", () => {
    render(<ResultPanel state={{ kind: "success", result: triageResult() }} onRetry={vi.fn()} canRetry />);
    expect(screen.getByText("MOCK RESULT")).toBeInTheDocument();
    expect(screen.getByText(/not produced by Gemma or any model/)).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Human review required")).toBeInTheDocument();
    expect(screen.getByText("mock-synthetic-rules-v1")).toBeInTheDocument();
  });

  it("does not label real-model results as mock", () => {
    const result = triageResult({ provider: "gemma", model_id: GEMMA_READY.model_id, is_mock: false, severity: "P3" });
    render(<ResultPanel state={{ kind: "success", result }} onRetry={vi.fn()} canRetry />);
    expect(screen.queryByText("MOCK RESULT")).not.toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText(GEMMA_READY.model_id)).toBeInTheDocument();
  });

  it("shows only fields the API returned (no invented outputs)", () => {
    const { container } = render(
      <ResultPanel state={{ kind: "success", result: triageResult() }} onRetry={vi.fn()} canRetry />,
    );
    const text = container.textContent?.toLowerCase() ?? "";
    for (const word of ["confidence", "root cause", "recommend", "explanation"]) {
      expect(text).not.toContain(word);
    }
  });

  it("offers retry for retryable errors", () => {
    const onRetry = vi.fn();
    const error = new ApiError("invalid_output", "The model returned an invalid severity output.", 502, "invalid_model_output", "r1");
    render(<ResultPanel state={{ kind: "error", error }} onRetry={onRetry} canRetry />);
    expect(screen.getByRole("alert")).toHaveTextContent("Model returned invalid output");
    expect(screen.getByText("No severity was predicted for this incident.")).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not offer retry for validation errors", () => {
    const error = new ApiError("validation", "The request is invalid.", 422, "validation_error");
    render(<ResultPanel state={{ kind: "error", error }} onRetry={vi.fn()} canRetry />);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
