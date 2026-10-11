import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { HomeView } from "@/components/HomeView";
import type { InferenceHealth } from "@/lib/types";
import { GEMMA_READY, health, jsonResponse } from "./helpers";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const WITH_TRIAGE: InferenceHealth = {
  ...GEMMA_READY,
  triage: { available: true, adapter: "gemma3-270m-triage-v3", model_id: "google/gemma-3-270m-it + LoRA:gemma3-270m-triage-v3", prompt_format: "v3", detail: "loaded" },
};

function stub(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      for (const [suffix, h] of Object.entries(routes)) if (url.endsWith(suffix)) return h();
      throw new TypeError("Failed to fetch");
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Home", () => {
  it("offers the three starting points and shows measured numbers from the API", async () => {
    const m = (c: number) => ({ correct: c, total: 100, accuracy: c / 100 });
    stub({
      "/health": () => jsonResponse(200, health(WITH_TRIAGE)),
      "/api/v1/tickets/session": () => jsonResponse(200, { total: 120, issued: 3, analyzed: 2, exhausted: false, current: null, current_analysis: null }),
      "/api/v1/triage/evaluation": () =>
        jsonResponse(200, { available: true, adapter: "gemma3-270m-triage-v3", detail: "", source: "", base_model: null, fine_tuned: { category: m(100), root_cause: m(100) }, not_measured: [] }),
      "/api/v1/tickets/evaluation": () =>
        jsonResponse(200, { provider: "gemma", model_id: "x", is_mock: false, total_tickets: 120, analyzed: 2, correct: 2, invalid_outputs: 0, accuracy: 1, labels: ["P1", "P2", "P3", "P4"], confusion_matrix: {}, results: [] }),
    });
    render(<AppShell><HomeView /></AppShell>);

    expect(screen.getByRole("link", { name: /Triage an incident/ })).toHaveAttribute("href", "/triage");
    expect(screen.getByRole("link", { name: /Work the ticket queue/ })).toHaveAttribute("href", "/queue");
    expect(screen.getByRole("link", { name: /Review and route/ })).toHaveAttribute("href", "/reviews");
    expect(await screen.findByText("3 of 120 issued · 2 analyzed")).toBeInTheDocument();
    const model = screen.getByRole("region", { name: "The model" });
    expect(await within(model).findAllByText("100%")).toHaveLength(3); // category, root cause, severity (this session)
    expect(within(model).getByText(/severity adapter · this session n=2/)).toBeInTheDocument();

    // The logo and the Home item both lead back here.
    for (const logo of screen.getAllByRole("link", { name: "TriageLens home" })) expect(logo).toHaveAttribute("href", "/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: /Home/ })).toHaveAttribute("aria-current", "page");
  });
});
