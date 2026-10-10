import { describe, expect, it } from "vitest";
import { SAMPLE_INCIDENTS } from "@/lib/samples";
import { EMPTY_FORM, formFieldFromApi, validateIncident, type IncidentFormValues } from "@/lib/validation";

const valid: IncidentFormValues = SAMPLE_INCIDENTS[0];

describe("validateIncident", () => {
  it("reports every required field on an empty form", () => {
    const result = validateIncident(EMPTY_FORM);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ["affected_service", "affected_users", "business_impact", "description", "title"].sort(),
    );
    expect(result.errors.title).toBe("Incident title is required.");
  });

  it("accepts every sample incident", () => {
    for (const sample of SAMPLE_INCIDENTS) expect(validateIncident(sample).ok).toBe(true);
  });

  it("builds the API request, trimming text and mapping workaround", () => {
    const result = validateIncident({ ...valid, title: "  Spaced title  ", workaround: "no" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.title).toBe("Spaced title");
    expect(result.request.affected_users).toBe(45);
    expect(result.request.workaround_available).toBe(false);
    expect(validateIncident({ ...valid, workaround: "yes" })).toMatchObject({ request: { workaround_available: true } });
    expect(validateIncident({ ...valid, workaround: "unknown" })).toMatchObject({
      request: { workaround_available: null },
    });
  });

  it.each([
    ["-1", "Enter a whole number (0 or more)."],
    ["4.5", "Enter a whole number (0 or more)."],
    ["abc", "Enter a whole number (0 or more)."],
    ["1000001", "Must be at most 1,000,000."],
    ["", "Number of affected users is required."],
  ])("rejects affected_users=%j", (raw, message) => {
    const result = validateIncident({ ...valid, affected_users: raw });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.affected_users).toBe(message);
  });

  it("enforces length limits", () => {
    const result = validateIncident({ ...valid, title: "ab", description: "x".repeat(4001) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.title).toMatch(/at least 3/);
    expect(result.errors.description).toMatch(/at most 4000/);
  });

  it("rejects duplicate and oversized list entries", () => {
    const dup = validateIncident({ ...valid, affected_sites: ["Pune", "pune"] });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.affected_sites).toMatch(/more than once/);

    const many = validateIncident({ ...valid, affected_departments: Array.from({ length: 21 }, (_, i) => `D${i}`) });
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.errors.affected_departments).toMatch(/at most 20/);
  });
});

describe("formFieldFromApi", () => {
  it("maps backend field paths to form fields", () => {
    expect(formFieldFromApi("title")).toBe("title");
    expect(formFieldFromApi("affected_sites.1")).toBe("affected_sites");
    expect(formFieldFromApi("workaround_available")).toBe("workaround");
    expect(formFieldFromApi("confidence")).toBeNull();
  });
});
