import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets, transitionScanStatus } from "@/lib/scan/service";
import { ingestFindings } from "@/lib/scan/findings";
import { buildReport, getReport, ReportGuardError } from "@/lib/scan/report";
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
    // a second, later approved version supersedes it
    const v2 = await createScopeVersion(ctx, set.id, { assetIds: [linkedAssetId] });
    await submitScopeVersion(ctx, v2.id);
    await approveScopeVersion(ctx, v2.id);
    expect(await resolveReportScopeVersionId(ctx, scanId)).toBe(v2.id);
    // an approved version in another set also resolves (latest approved per set)
    const otherSet = await createScopeSet(ctx, { name: "Scope-Other" });
    const ov1 = await createScopeVersion(ctx, otherSet.id, { assetIds: [linkedAssetId] });
    await submitScopeVersion(ctx, ov1.id);
    await approveScopeVersion(ctx, ov1.id);
    expect(await resolveReportScopeVersionId(ctx, scanId)).toBeTruthy();
    // a draft version never resolves
    const emptySet = await createScopeSet(ctx, { name: "Empty" });
    await createScopeVersion(ctx, emptySet.id, { assetIds: [linkedAssetId] }); // stays draft
    expect(await resolveReportScopeVersionId(ctx, scanId)).toBeTruthy(); // still resolves via the approved ones
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
    // prior test left Scope-Linked v2 (approved, latest per set) covering linkedAssetId
    const expected = await resolveReportScopeVersionId(ctx, scanId);
    expect(expected).toBeTruthy();
    const report = await buildReport(ctx, scanId);
    expect(report.scopeVersionId).toBe(expected);
    // a NEWER approved version in another set exists now; refresh must not re-point
    const set2 = await createScopeSet(ctx, { name: "Scope-Newer" });
    const nv1 = await createScopeVersion(ctx, set2.id, { assetIds: [linkedAssetId] });
    await submitScopeVersion(ctx, nv1.id);
    await approveScopeVersion(ctx, nv1.id);
    const refreshed = await buildReport(ctx, scanId);
    expect(refreshed.id).toBe(report.id); // upsert by scanId
    expect(refreshed.scopeVersionId).toBe(report.scopeVersionId); // link frozen at first resolution
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