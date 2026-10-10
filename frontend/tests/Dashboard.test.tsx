import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Dashboard } from "@/components/Dashboard";
import type { InferenceHealth } from "@/lib/types";
import { renderInShell } from "./render";
import { GEMMA_READY, MOCK_INFERENCE, health, jsonResponse, stubFetch, triageCalls, triageResult } from "./helpers";

const status = () => screen.getByRole("status", { name: "System status" });
const analyze = () => screen.getByRole("button", { name: /Analyze incident|Analyzing/ });

describe("Dashboard", () => {
  it("shows mock mode clearly and returns a labelled mock result", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({
      health: () => jsonResponse(200, health(MOCK_INFERENCE)),
      triage: () => jsonResponse(200, triageResult()),
    });
    renderInShell(<Dashboard />);

    expect(await screen.findByText(/MOCK INFERENCE ACTIVE/)).toBeInTheDocument();
    expect(within(status()).getByText("Mock")).toBeInTheDocument();
    expect(within(status()).getByText("Mock mode · no model")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load sample incident" }));
    await user.click(analyze());

    expect(await screen.findByText("MOCK RESULT")).toBeInTheDocument();
    expect(triageCalls(fetchMock)).toHaveLength(1);
    const recent = screen.getByRole("region", { name: "Recent activity" });
    expect(within(recent).getByText("Microsoft 365 sign-in failures")).toBeInTheDocument();
    expect(within(recent).getByText("MOCK")).toBeInTheDocument();
  });

  it("shows field errors and does not call the API for an invalid form", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ health: () => jsonResponse(200, health(MOCK_INFERENCE)) });
    renderInShell(<Dashboard />);
    await screen.findByText(/MOCK INFERENCE ACTIVE/);

    await user.click(analyze());

    expect(screen.getByText("Incident title is required.")).toBeInTheDocument();
    expect(screen.getByText("Number of affected users is required.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Incident title/)).toHaveAttribute("aria-invalid", "true");
    expect(triageCalls(fetchMock)).toHaveLength(0);
  });

  it("disables duplicate submissions while inference is running", async () => {
    const user = userEvent.setup();
    let release: (value: Response) => void = () => {};
    const fetchMock = stubFetch({
      health: () => jsonResponse(200, health(MOCK_INFERENCE)),
      triage: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    renderInShell(<Dashboard />);
    await screen.findByText(/MOCK INFERENCE ACTIVE/);
    await user.click(screen.getByRole("button", { name: "Load sample incident" }));
    await user.click(analyze());

    expect(analyze()).toBeDisabled();
    expect(analyze()).toHaveTextContent("Analyzing…");
    await user.click(analyze());
    expect(triageCalls(fetchMock)).toHaveLength(1);

    release(jsonResponse(200, triageResult()));
    expect(await screen.findByText("MOCK RESULT")).toBeInTheDocument();
    expect(analyze()).toBeEnabled();
  });

  it("shows API errors with a retry action", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubFetch({
      health: () => jsonResponse(200, health(GEMMA_READY)),
      triage: () =>
        ++attempts === 1
          ? jsonResponse(502, {
              error: { code: "invalid_model_output", message: "The model returned an invalid severity output.", request_id: "r1" },
            })
          : jsonResponse(200, triageResult({ provider: "gemma", model_id: GEMMA_READY.model_id, is_mock: false })),
    });
    renderInShell(<Dashboard />);
    await waitFor(() => expect(within(status()).getByText("Ready")).toBeInTheDocument());
    expect(screen.queryByText(/MOCK INFERENCE ACTIVE/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load sample incident" }));
    await user.click(analyze());
    expect(await screen.findByText("Model returned invalid output")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Critical")).toBeInTheDocument();
    expect(screen.queryByText("MOCK RESULT")).not.toBeInTheDocument();
  });

  it("maps backend 422 field errors onto the form", async () => {
    const user = userEvent.setup();
    stubFetch({
      health: () => jsonResponse(200, health(MOCK_INFERENCE)),
      triage: () =>
        jsonResponse(422, {
          error: {
            code: "validation_error",
            message: "The request is invalid.",
            details: [{ field: "affected_sites", message: "Value error, duplicate entry: 'Pune'" }],
          },
        }),
    });
    renderInShell(<Dashboard />);
    await screen.findByText(/MOCK INFERENCE ACTIVE/);
    await user.click(screen.getByRole("button", { name: "Load sample incident" }));
    await user.click(analyze());

    expect(await screen.findByText("Value error, duplicate entry: 'Pune'")).toBeInTheDocument();
    expect(screen.getByText("Input rejected by the API")).toBeInTheDocument();
  });

  it("shows the backend-unavailable state and blocks analysis", async () => {
    stubFetch({});
    renderInShell(<Dashboard />);
    expect(await screen.findByText("Backend unavailable")).toBeInTheDocument();
    expect(within(status()).getByText("Offline")).toBeInTheDocument();
    expect(within(status()).getByText("Unknown")).toBeInTheDocument(); // model state is not guessed
    expect(analyze()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry connection" })).toBeInTheDocument();
  });

  it.each<[InferenceHealth["state"], string, string]>([
    ["loading", "Loading…", "Model loading"],
    ["unavailable", "Unavailable", "Model unavailable"],
  ])("never reports a %s model as ready", async (state, pill, banner) => {
    const inference: InferenceHealth = { ...GEMMA_READY, state, ready: false, model_loaded: false, detail: "detail text" };
    stubFetch({ health: () => jsonResponse(200, health(inference)) });
    renderInShell(<Dashboard />);
    expect(await screen.findByText(banner)).toBeInTheDocument();
    expect(within(status()).getByText("Online")).toBeInTheDocument(); // API up...
    expect(within(status()).getByText(pill)).toBeInTheDocument(); // ...model not ready
    expect(within(status()).queryByText("Ready")).not.toBeInTheDocument();
    expect(analyze()).toBeDisabled();
  });
});
