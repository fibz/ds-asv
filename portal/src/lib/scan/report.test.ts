import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets, transitionScanStatus } from "@/lib/scan/service";
import { ingestFindings } from "@/lib/scan/findings";
import { buildReport, getReport, ReportGuardError, listReports } from "@/lib/scan/report";
import { submitReport, attestReport, isReportFinal } from "@/lib/scan/report";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_report_0001";
const USER = "user_report_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}
const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "report_viewer", isStaff: false, appMode: "prod" };

let assetId = "";

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const t of ["ReportAttestation", "Report", "Finding", "ScanTarget", "Scan", "AuditEvent", "Asset"]) {
      await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [ORG]);
    }
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("report generation", () => {
  let scanId = "";
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, (tx) => tx.organization.create({ data: { id: ORG, name: "Report Org" } }));
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-report", email: "r@x.com" } }));
    assetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_report_1", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.3.3.3", lifecycleState: "active", verificationState: "verified" } }))).id;
    scanId = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "report scan", assetIds: [assetId] })).id;
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, scanId, "RUNNING");
    await ingestFindings({ ...ctx, role: "scan_operator" }, scanId, [
      { assetId, qid: "q1", severity: "4", pciSeverity: "High", title: "TLS weak" },
      { assetId, qid: "q2", severity: "2", pciSeverity: "Low", title: "Banner" },
    ]);
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, scanId, "COMPLETED");
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("builds a Qualys-style summary from findings (idempotent)", async () => {
    const report = await buildReport(ctx, scanId);
    expect(report.status).toBe("draft");
    expect((report.summary as any).hosts).toBe(1);
    expect((report.summary as any).vulnerabilities).toBe(2);
    expect((report.summary as any).bySeverity).toEqual({ "2": 1, "4": 1 });
    expect((report.summary as any).byPciSeverity).toEqual({ High: 1, Low: 1 });
    expect((report.summary as any).compliance).toBe("FAILED"); // severity-4 present
    const again = await buildReport(ctx, scanId);
    expect(again.id).toBe(report.id); // upsert by scanId — no duplicate report
  });

  it("rejects building a report for a non-completed scan", async () => {
    const pending = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "pending", assetIds: [assetId] })).id;
    await expect(buildReport(ctx, pending)).rejects.toBeInstanceOf(ReportGuardError);
  });

  it("is tenant-scoped and audited", async () => {
    const report = await buildReport(ctx, scanId);
    const other: TenantContext = { userId: USER, organizationId: "org_report_0002", role: "report_viewer", isStaff: false, appMode: "prod" };
    expect(await getReport(other, report.id)).toBeNull();
    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { action: "report.generated", resourceId: report.id } }));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("QA attestation gate", () => {
  let scanId = "";
  let draftScanId = "";
  let draftAssetId = "";
  beforeAll(async () => {
    vi.stubEnv("APP_MODE", "prod");
    await adminWipe();
    await withTenant(ORG, (tx) => tx.organization.create({ data: { id: ORG, name: "Report Org" } }));
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-report", email: "r@x.com" } }));
    assetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_report_1", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.3.3.3", lifecycleState: "active", verificationState: "verified" } }))).id;
    draftAssetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_report_2", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.3.3.4", lifecycleState: "active", verificationState: "verified" } }))).id;
    // This describe runs under prod (stubbed above), so the Task 4 scope gate
    // requires both assets to sit in an approved scope version before scans.
    const { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion } = await import("@/lib/scope/service");
    const scopeSet = await createScopeSet(ctx, { name: "Report Gate" });
    const scopeVersion = await createScopeVersion(ctx, scopeSet.id, { assetIds: [assetId, draftAssetId] });
    await submitScopeVersion(ctx, scopeVersion.id);
    await approveScopeVersion(ctx, scopeVersion.id);
    // Scan for test 1 (fully transitions to attested).
    scanId = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "report scan", assetIds: [assetId] })).id;
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, scanId, "RUNNING");
    await ingestFindings({ ...ctx, role: "scan_operator" }, scanId, [
      { assetId, qid: "q1", severity: "4", pciSeverity: "High", title: "TLS weak" },
      { assetId, qid: "q2", severity: "2", pciSeverity: "Low", title: "Banner" },
    ]);
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, scanId, "COMPLETED");
    // Distinct scan for test 2 — its report must stay a genuine draft.
    draftScanId = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "draft report scan", assetIds: [draftAssetId] })).id;
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, draftScanId, "RUNNING");
    await ingestFindings({ ...ctx, role: "scan_operator" }, draftScanId, [
      { assetId: draftAssetId, qid: "q3", severity: "1", pciSeverity: "Low", title: "Minor" },
    ]);
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, draftScanId, "COMPLETED");
  });
  afterAll(async () => { vi.unstubAllEnvs(); await adminWipe(); await prisma.$disconnect(); });

  it("report is not final until attested; prod requires staff for attest", async () => {
    const report = await buildReport(ctx, scanId);
    expect(isReportFinal(report)).toBe(false);
    const submitted = await submitReport(ctx, report.id);
    expect(submitted?.status).toBe("submitted");
    // report_viewer (non-staff) in prod cannot attest
    await expect(attestReport(ctx, report.id)).rejects.toThrow(/attest/);
    const staff: TenantContext = { ...ctx, isStaff: true };
    const attested = await attestReport(staff, report.id);
    expect(attested?.status).toBe("attested");
    expect(isReportFinal(attested!)).toBe(true);
    // audit rows prove the submit→attest writes
    const submitAudits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { action: "report.submitted", resourceId: report.id } }));
    const attestAudits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { action: "report.attested", resourceId: report.id } }));
    expect(submitAudits.length).toBeGreaterThanOrEqual(1);
    expect(attestAudits.length).toBeGreaterThanOrEqual(1);
  });

  it("attestation transitions are guarded (draft → attested rejected)", async () => {
    // A genuine DRAFT report from a distinct scan (not the attested report from test 1).
    const draftReport = await buildReport(ctx, draftScanId);
    expect(draftReport.status).toBe("draft");
    expect(isReportFinal(draftReport)).toBe(false);
    const staff: TenantContext = { ...ctx, isStaff: true };
    // draft → attested is invalid (must go through submitted first)
    await expect(attestReport(staff, draftReport.id)).rejects.toThrow(/submitted/);
    // ...but the full draft → submitted → attested path is valid
    const submitted = await submitReport(ctx, draftReport.id);
    expect(submitted?.status).toBe("submitted");
    const attested = await attestReport(staff, draftReport.id);
    expect(attested?.status).toBe("attested");
    expect(isReportFinal(attested!)).toBe(true);
  });

  it("prod attest rejects a report with no approved scope version (null or never-approved link)", async () => {
    // Negative case for the Phase 5 prod scope guard (review round 1). The
    // Task 4 scan gate forbids creating scans for out-of-scope assets in prod,
    // so a genuinely no-coverage scan + report can only exist when that gate is
    // relaxed — build it under dev, then attest under prod. (Positive control:
    // test 1 above attests an approved-scope report successfully under the same
    // prod env.)
    vi.stubEnv("APP_MODE", "dev");
    const noScopeAssetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_report_no_scope", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.3.3.21", lifecycleState: "active", verificationState: "verified" } }))).id;
    const noScopeScanId = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "no scope scan", assetIds: [noScopeAssetId] })).id;
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, noScopeScanId, "RUNNING");
    await ingestFindings({ ...ctx, role: "scan_operator" }, noScopeScanId, [
      { assetId: noScopeAssetId, qid: "q1", severity: "4", pciSeverity: "High", title: "TLS weak" },
    ]);
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, noScopeScanId, "COMPLETED");
    const unlinked = await buildReport(ctx, noScopeScanId);
    expect(unlinked.scopeVersionId).toBeNull(); // genuinely no approved coverage
    await submitReport(ctx, unlinked.id);
    vi.stubEnv("APP_MODE", "prod");
    const staff: TenantContext = { ...ctx, isStaff: true };
    // null link → guard rejects before any attestation write
    await expect(attestReport(staff, unlinked.id)).rejects.toThrow(
      "cannot attest: report has no approved scope version (required in prod)"
    );
    // never-approved link (report forced onto a draft version) → same rejection
    const { createScopeSet, createScopeVersion } = await import("@/lib/scope/service");
    const set = await createScopeSet(ctx, { name: "No Approve" });
    const draftV = await createScopeVersion(ctx, set.id, { assetIds: [noScopeAssetId] }); // stays draft
    await withTenant(ORG, (tx) => tx.report.update({ where: { id: unlinked.id }, data: { scopeVersionId: draftV.id } }));
    await expect(attestReport(staff, unlinked.id)).rejects.toThrow(
      "cannot attest: report has no approved scope version (required in prod)"
    );
  });
});

describe("report scope linkage (Phase 5)", () => {
  // Self-contained harness (scanId is not file-scope in this file — each
  // describe seeds its own scan). Runs under the file's dev env (no
  // APP_MODE stub in effect here — the QA describe's afterAll unstubbed it),
  // so createScanFromAssets does not trip the prod scope gate.
  let scanId = "";
  let linkedAssetId = "";
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, (tx) => tx.organization.create({ data: { id: ORG, name: "Report Org" } }));
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-report", email: "r@x.com" } }));
    linkedAssetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_report_link", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.3.3.9", lifecycleState: "active", verificationState: "verified" } }))).id;
    scanId = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "linkage scan", assetIds: [linkedAssetId] })).id;
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, scanId, "RUNNING");
    await ingestFindings({ ...ctx, role: "scan_operator" }, scanId, [
      { assetId: linkedAssetId, qid: "q1", severity: "4", pciSeverity: "High", title: "TLS weak" },
    ]);
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, scanId, "COMPLETED");
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("resolveReportScopeVersionId returns the latest approved scope version containing a target", async () => {
    const { resolveReportScopeVersionId } = await import("@/lib/scan/service");
    const { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion } = await import("@/lib/scope/service");
    // linkedAssetId is already scanned but in NO approved scope version yet
    const set = await createScopeSet(ctx, { name: "Scope-Linked" });
    const v1 = await createScopeVersion(ctx, set.id, { assetIds: [linkedAssetId] });
    await submitScopeVersion(ctx, v1.id);
    await approveScopeVersion(ctx, v1.id);
    expect(await resolveReportScopeVersionId(ctx, scanId)).toBe(v1.id);
    // a second, later approved version of the same set supersedes it
    const v2 = await createScopeVersion(ctx, set.id, { assetIds: [linkedAssetId] });
    await submitScopeVersion(ctx, v2.id);
    await approveScopeVersion(ctx, v2.id);
    expect(await resolveReportScopeVersionId(ctx, scanId)).toBe(v2.id);
    // a draft version never supersedes an approved one — resolution is unchanged
    const draftSet = await createScopeSet(ctx, { name: "Scope-Draft" });
    await createScopeVersion(ctx, draftSet.id, { assetIds: [linkedAssetId] }); // stays draft
    expect(await resolveReportScopeVersionId(ctx, scanId)).toBe(v2.id);
  });

  it("resolveReportScopeVersionId is null for a scan with no approved coverage", async () => {
    const { resolveReportScopeVersionId } = await import("@/lib/scan/service");
    const orphanAssetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_report_orphan", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.3.3.10", lifecycleState: "active", verificationState: "verified" } }))).id;
    const orphanScanId = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "orphan scan", assetIds: [orphanAssetId] })).id;
    expect(await resolveReportScopeVersionId(ctx, orphanScanId)).toBeNull();
  });

  it("buildReport records the approved scope version on create and never re-points an existing link", async () => {
    const { resolveReportScopeVersionId } = await import("@/lib/scan/service");
    const { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion } = await import("@/lib/scope/service");
    // Own asset + scan + scope set for this test: nothing else in the suite
    // approves a version covering this asset, so every resolution below is
    // deterministic regardless of scope-set id ordering.
    const frozenAssetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_report_frozen", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.3.3.12", lifecycleState: "active", verificationState: "verified" } }))).id;
    const frozenScanId = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "frozen scan", assetIds: [frozenAssetId] })).id;
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, frozenScanId, "RUNNING");
    await ingestFindings({ ...ctx, role: "scan_operator" }, frozenScanId, [
      { assetId: frozenAssetId, qid: "q4", severity: "1", pciSeverity: "Low", title: "Minor" },
    ]);
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, frozenScanId, "COMPLETED");

    const set = await createScopeSet(ctx, { name: "Scope-Frozen" });
    const v1 = await createScopeVersion(ctx, set.id, { assetIds: [frozenAssetId] });
    await submitScopeVersion(ctx, v1.id);
    await approveScopeVersion(ctx, v1.id);
    // v1 is the only approved version covering frozenAssetId → create links to it
    expect(await resolveReportScopeVersionId(ctx, frozenScanId)).toBe(v1.id);
    const report = await buildReport(ctx, frozenScanId);
    expect(report.scopeVersionId).toBe(v1.id);
    // a newer approved version in the SAME set supersedes for the resolver …
    const v2 = await createScopeVersion(ctx, set.id, { assetIds: [frozenAssetId] });
    await submitScopeVersion(ctx, v2.id);
    await approveScopeVersion(ctx, v2.id);
    expect(await resolveReportScopeVersionId(ctx, frozenScanId)).toBe(v2.id);
    // … but the report's link stays frozen at the ORIGINAL v1 (never re-point).
    // Without the `existing.scopeVersionId == null` guard on the update path,
    // refresh would overwrite the link to v2.id and this assertion fails.
    const refreshed = await buildReport(ctx, frozenScanId);
    expect(refreshed.id).toBe(report.id); // upsert by scanId
    expect(refreshed.scopeVersionId).toBe(v1.id);
  });

  it("buildReport leaves the link null for a dev-built report with no approved coverage", async () => {
    const orphanAssetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_report_orphan2", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.3.3.11", lifecycleState: "active", verificationState: "verified" } }))).id;
    const orphanScanId = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "orphan scan 2", assetIds: [orphanAssetId] })).id;
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, orphanScanId, "RUNNING");
    await ingestFindings({ ...ctx, role: "scan_operator" }, orphanScanId, [
      { assetId: orphanAssetId, qid: "q9", severity: "1", pciSeverity: "Low", title: "Minor" },
    ]);
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, orphanScanId, "COMPLETED");
    const report = await buildReport(ctx, orphanScanId);
    expect(report.scopeVersionId).toBeNull();
  });
});

describe("report finalization gate (Phase 5)", () => {
  // Self-contained harness: scanId is per-describe in this file (Task 1
  // discovery), so this gate seeds its own asset + COMPLETED scan with
  // findings, mirroring the "frozen" describe above. Runs under the file's
  // dev env (no APP_MODE stub in effect) — the scope approval below links the
  // report to the ONLY approved version covering the gate asset.
  let gateAssetId = "";
  let gateScanId = "";
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, (tx) => tx.organization.create({ data: { id: ORG, name: "Report Org" } }));
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-report", email: "r@x.com" } }));
    gateAssetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_report_gate", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.3.3.13", lifecycleState: "active", verificationState: "verified" } }))).id;
    gateScanId = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "gate scan", assetIds: [gateAssetId] })).id;
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, gateScanId, "RUNNING");
    await ingestFindings({ ...ctx, role: "scan_operator" }, gateScanId, [
      { assetId: gateAssetId, qid: "q1", severity: "4", pciSeverity: "High", title: "TLS weak" },
    ]);
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, gateScanId, "COMPLETED");
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("report is NOT final unless attested AND its linked scope version is approved", async () => {
    const { buildReport, isReportFinal } = await import("@/lib/scan/report");
    const { approveScopeVersion, createScopeSet, createScopeVersion, submitScopeVersion } = await import("@/lib/scope/service");
    const set = await createScopeSet(ctx, { name: "Gate" });
    const v = await createScopeVersion(ctx, set.id, { assetIds: [gateAssetId] });
    await submitScopeVersion(ctx, v.id);
    await approveScopeVersion(ctx, v.id);
    const report = await buildReport(ctx, gateScanId);
    expect(report.scopeVersionId).toBe(v.id); // linkage recorded
    // draft + approved scope → not final
    expect(isReportFinal({ status: "draft", scopeVersionId: v.id, approvedScopeVersionId: v.id })).toBe(false);
    // attested + approved scope → final
    expect(isReportFinal({ status: "attested", scopeVersionId: v.id, approvedScopeVersionId: v.id })).toBe(true);
    // attested + approved scope but a DIFFERENT/later approved version id → not final (the linked one must be THE approved one)
    expect(isReportFinal({ status: "attested", scopeVersionId: "other_v", approvedScopeVersionId: v.id })).toBe(false);
    // attested + null scope link → not final (dev report with no authority)
    expect(isReportFinal({ status: "attested", scopeVersionId: null, approvedScopeVersionId: null })).toBe(false);
  });
});

describe("report listing (Phase 5)", () => {
  // Self-contained harness (same pattern as the other describes: own asset +
  // COMPLETED scan with findings, dev env — no APP_MODE stub in effect here,
  // so createScanFromAssets does not trip the prod scope gate). The report is
  // submitted so the include'd attestation row exists for the shape check.
  let listingReportId = "";
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, (tx) => tx.organization.create({ data: { id: ORG, name: "Report Org" } }));
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-report", email: "r@x.com" } }));
    const listingAssetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_report_list", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.3.3.30", lifecycleState: "active", verificationState: "verified" } }))).id;
    const listingScanId = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "listing scan", assetIds: [listingAssetId] })).id;
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, listingScanId, "RUNNING");
    await ingestFindings({ ...ctx, role: "scan_operator" }, listingScanId, [
      { assetId: listingAssetId, qid: "q1", severity: "4", pciSeverity: "High", title: "TLS weak" },
    ]);
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, listingScanId, "COMPLETED");
    const report = await buildReport(ctx, listingScanId);
    listingReportId = report.id;
    await submitReport(ctx, report.id); // attestation row (status submitted)
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("returns org-scoped reports with the attestation attached", async () => {
    const reports = await listReports(ctx);
    const row = reports.find((r) => r.id === listingReportId);
    expect(row).toBeDefined();
    expect(row!.scanId).toBeTruthy();
    expect(row!.status).toBe("submitted");
    expect(row!.scopeVersionId).toBeNull(); // dev-built report — no approved scope authority
    expect(row!.attestation).not.toBeNull();
    expect(row!.attestation!.reportId).toBe(listingReportId);
    expect(row!.attestation!.status).toBe("submitted");
  });

  it("is org-scoped — another organization sees no rows", async () => {
    const other: TenantContext = { ...ctx, organizationId: "org_report_0002" };
    expect(await listReports(other)).toEqual([]);
  });
});
