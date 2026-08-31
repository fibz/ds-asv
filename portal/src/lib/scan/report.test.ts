import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets, transitionScanStatus } from "@/lib/scan/service";
import { ingestFindings } from "@/lib/scan/findings";
import { buildReport, getReport, ReportGuardError } from "@/lib/scan/report";
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
