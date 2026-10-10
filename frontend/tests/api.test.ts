import { describe, expect, it } from "vitest";
import { ApiError, getHealth, submitTriage } from "@/lib/api";
import type { TriageRequest } from "@/lib/types";
import { MOCK_INFERENCE, health, jsonResponse, stubFetch, triageResult } from "./helpers";

const request: TriageRequest = {
  title: "Microsoft 365 sign-in failures",
  description: "Multiple employees cannot sign in.",
  affected_service: "Microsoft 365",
  affected_users: 45,
  affected_departments: ["Finance"],
  affected_sites: ["Mumbai"],
  business_impact: "Employees cannot access business applications.",
  workaround_available: null,
  diagnostic_evidence: "",
};

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error("expected the call to fail");
}

const envelope = (code: string, message: string, extra: object = {}) => ({
  error: { code, message, request_id: "req-1", ...extra },
});

describe("api client", () => {
  it("posts JSON to the configured backend and returns the response", async () => {
    const fetchMock = stubFetch({ triage: () => jsonResponse(200, triageResult()) });
    const result = await submitTriage(request);
    expect(result.severity).toBe("P1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/api/v1/triage");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it("returns health", async () => {
    stubFetch({ health: () => jsonResponse(200, health(MOCK_INFERENCE)) });
    expect((await getHealth()).inference.is_mock).toBe(true);
  });

  it("maps 422 validation errors with field details", async () => {
    stubFetch({
      triage: () =>
        jsonResponse(
          422,
          envelope("validation_error", "The request is invalid.", {
            details: [{ field: "affected_users", message: "Input should be greater than or equal to 0" }],
          }),
        ),
    });
    const error = await captureError(submitTriage(request));
    expect(error.kind).toBe("validation");
    expect(error.status).toBe(422);
    expect(error.retryable).toBe(false);
    expect(error.fieldErrors).toEqual([
      { field: "affected_users", message: "Input should be greater than or equal to 0" },
    ]);
  });

  it.each([
    [503, "provider_not_ready", "not_ready"],
    [503, "provider_unavailable", "unavailable"],
    [500, "inference_failed", "inference"],
    [502, "invalid_model_output", "invalid_output"],
    [418, "something_new", "unknown"],
  ])("maps HTTP %i %s to kind %s", async (status, code, kind) => {
    stubFetch({ triage: () => jsonResponse(status, envelope(code, "Server message.")) });
    const error = await captureError(submitTriage(request));
    expect(error.kind).toBe(kind);
    expect(error.code).toBe(code);
    expect(error.message).toBe("Server message.");
    expect(error.requestId).toBe("req-1");
    expect(error.retryable).toBe(true);
  });

  it("reports an unreachable backend as a network error", async () => {
    stubFetch({});
    const error = await captureError(submitTriage(request));
    expect(error.kind).toBe("network");
    expect(error.message).toMatch(/Cannot reach the triage API at http:\/\/localhost:8000/);
  });

  it("handles non-JSON error bodies", async () => {
    stubFetch({ triage: () => jsonResponse(500, undefined) });
    const error = await captureError(submitTriage(request));
    expect(error.kind).toBe("unknown");
    expect(error.status).toBe(500);
  });
});
