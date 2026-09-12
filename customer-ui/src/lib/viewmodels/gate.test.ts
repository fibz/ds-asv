import { describe, it, expect } from "vitest";
import { reportGate, finalReportIdsOf, approvedScopeVersionIdFor } from "./gate";

const base = {
  status: "attested", scopeVersionId: "v4", approvedScopeVersionId: "v4",
  attestationStatus: "attested", scopeLabel: "v4", attestedAt: "2026-09-03",
};

describe("reportGate", () => {
  it("is final only when attested AND backed by the approved scope version", () => {
    expect(reportGate(base).isFinal).toBe(true);
    expect(reportGate({ ...base, approvedScopeVersionId: "v5" }).isFinal).toBe(false);
    expect(reportGate({ ...base, status: "submitted" }).isFinal).toBe(false);
    expect(reportGate({ ...base, scopeVersionId: null, approvedScopeVersionId: null }).isFinal).toBe(false);
  });

  it("names the missing condition rather than just saying not final", () => {
    const g = reportGate({ ...base, status: "submitted", attestationStatus: "submitted" });
    expect(g.blockReason).toBe("Attestation pending");
    expect(g.conditions.find((c) => c.key === "attestation")!.met).toBe(false);
    expect(g.conditions.find((c) => c.key === "scope")!.met).toBe(true);
  });

  it("explains a missing approved scope in its own words", () => {
    const g = reportGate({ ...base, scopeVersionId: null, approvedScopeVersionId: null });
    expect(g.blockReason).toBe("No approved scope version backs this report");
  });

  it("allows download only when final", () => {
    expect(reportGate(base).canDownload).toBe(true);
    expect(reportGate({ ...base, status: "draft" }).canDownload).toBe(false);
  });

  it("states the gate position in one sentence, with evidence", () => {
    expect(reportGate(base).sentence).toContain("Attested");
    expect(reportGate(base).conditions[1].evidence).toBe("v4");
  });
});

describe("finalReportIdsOf", () => {
  it("returns only reports whose gate passes", () => {
    const rows = [
      { id: "r1", status: "attested", scopeVersionId: "v4", attestation: { status: "attested", reviewedAt: "2026-09-03" } },
      { id: "r2", status: "submitted", scopeVersionId: "v4", attestation: { status: "submitted", reviewedAt: null } },
      { id: "r3", status: "attested", scopeVersionId: "v3", attestation: { status: "attested", reviewedAt: "2026-06-01" } },
    ];
    expect(finalReportIdsOf(rows, [{ id: "v4", status: "approved" }])).toEqual(["r1"]);
    expect(finalReportIdsOf(rows, [])).toEqual([]);
  });
});

describe("approvedScopeVersionIdFor", () => {
  it("returns the version id when that version is approved", () => {
    expect(approvedScopeVersionIdFor("v3", [{ id: "v3", status: "approved" }])).toBe("v3");
  });
  it("returns null when that version is not approved", () => {
    expect(approvedScopeVersionIdFor("v3", [{ id: "v3", status: "draft" }])).toBeNull();
    expect(approvedScopeVersionIdFor("v3", [{ id: "v3", status: "submitted" }])).toBeNull();
  });
  it("returns null for a report with no recorded version, or one not in the list", () => {
    expect(approvedScopeVersionIdFor(null, [{ id: "v3", status: "approved" }])).toBeNull();
    expect(approvedScopeVersionIdFor("v9", [{ id: "v3", status: "approved" }])).toBeNull();
  });
});

describe("finalReportIdsOf against the server rule", () => {
  const versions = [{ id: "v3", status: "approved" }, { id: "v4", status: "approved" }];
  const attested = (id: string, scopeVersionId: string) => ({ id, status: "attested", scopeVersionId, attestation: { status: "attested", reviewedAt: "2026-06-12" } });

  it("keeps a report backed by an OLDER approved version final after a newer scope is approved", () => {
    // This is the divergence this task exists to fix. The server calls it final.
    expect(finalReportIdsOf([attested("r1", "v3")], versions)).toEqual(["r1"]);
  });

  it("still withholds finality when the report's version was never approved", () => {
    expect(finalReportIdsOf([attested("r1", "v5")], versions)).toEqual([]);
    expect(finalReportIdsOf([attested("r1", "v3")], [{ id: "v3", status: "submitted" }])).toEqual([]);
  });

  it("still requires attestation", () => {
    expect(finalReportIdsOf([{ id: "r1", status: "submitted", scopeVersionId: "v3", attestation: { status: "submitted", reviewedAt: null } }], versions)).toEqual([]);
  });
});
