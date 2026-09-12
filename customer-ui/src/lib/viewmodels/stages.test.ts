import { describe, it, expect } from "vitest";
import { stageRows } from "./stages";

const asset = (over = {}) => ({ id: "a", type: "fqdn", canonicalIdentifier: "shop.example.com", displayName: null, owner: null, environment: null, criticality: "medium", lifecycleState: "active", verificationState: "verified", source: "manual", lastSeenAt: null, createdAt: "", updatedAt: "", ...over });
const scan = (over = {}) => ({ id: "s", name: "Q3", status: "COMPLETED", startedAt: "", completedAt: null, createdAt: "", manifestIssuedAt: null, manifestExpiresAt: null, ...over });
const report = (over = {}) => ({ id: "r", scanId: "s", status: "draft", scopeVersionId: null, attestationId: null, attestation: null, summary: null, createdAt: "", updatedAt: "", ...over });
const approved = { id: "v4", scopeSetId: "set", versionNumber: 4, status: "approved", contentHash: null, submittedAt: null, approvedAt: "2026-08-02", items: [] };

describe("stageRows", () => {
  it("marks everything pending for an empty organisation", () => {
    const rows = stageRows({ assets: [], approved: null, hasDraftScope: false, scans: [], reports: [], finalReportIds: [] });
    expect(rows.map((r) => r.state)).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("marks assets active while any are unverified", () => {
    const rows = stageRows({ assets: [asset({ verificationState: "unverified" })], approved: null, hasDraftScope: false, scans: [], reports: [], finalReportIds: [] });
    expect(rows[0].state).toBe("active");
    expect(rows[0].detail).toContain("1");
  });

  it("completes assets and scope when verification and approval exist", () => {
    const rows = stageRows({ assets: [asset()], approved: approved as never, hasDraftScope: false, scans: [], reports: [], finalReportIds: [] });
    expect(rows[0].state).toBe("complete");
    expect(rows[1].state).toBe("complete");
    expect(rows[1].detail).toContain("v4");
  });

  it("marks scans active while a scan is running and reports active until a report is final", () => {
    const rows = stageRows({
      assets: [asset()], approved: approved as never, hasDraftScope: false,
      scans: [scan({ status: "RUNNING" }), scan()],
      reports: [report({ status: "submitted" })],
      finalReportIds: [],
    });
    expect(rows[2].state).toBe("active");
    expect(rows[3].state).toBe("active");
    expect(rows[3].detail).toContain("attestation");
  });

  it("completes reports when one is final", () => {
    const rows = stageRows({
      assets: [asset()], approved: approved as never, hasDraftScope: false, scans: [scan()],
      reports: [report({ status: "attested" })], finalReportIds: ["r"],
    });
    expect(rows[3].state).toBe("complete");
  });
});
