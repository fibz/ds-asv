import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets, getScan, transitionScanStatus } from "@/lib/scan/service";
import { issueScanManifest, verifyScanManifest } from "@/lib/scan/manifest";
import { ingestFindings, runScanWithSimulatedScanner } from "@/lib/scan/findings";
import { buildReport, submitReport, attestReport, isReportFinal } from "@/lib/scan/report";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG_A = "org_scan_exit_a_001";
const ORG_B = "org_scan_exit_b_001";
const USER_A = "user_scan_exit_a_001";
const USER_B = "user_scan_exit_b_001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}
const ctxA: TenantContext = { userId: USER_A, organizationId: ORG_A, role: "scan_operator", isStaff: false, appMode: "prod" };
const staffA: TenantContext = { ...ctxA, isStaff: true };
const ctxB: TenantContext = { userId: USER_B, organizationId: ORG_B, role: "scan_operator", isStaff: false, appMode: "prod" };

let assetA = "";

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG_A, ORG_B]) {
      for (const t of ["ReportAttestation", "Report", "Finding", "ScanTarget", "Scan", "AuditEvent", "Asset"]) {
        await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [o]);
      }
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id IN ($1, $2)`, [USER_A, USER_B]);
  } finally { await admin.end(); }
}

describe("phase 3 exit criteria", () => {
  let scanId = "";
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG_A, ORG_B]) await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Exit ${o}` } }));
    await withTenant(ORG_A, (tx) => tx.user.create({ data: { id: USER_A, idpId: "kc-exit-a", email: "a@x.com" } }));
    await withTenant(ORG_B, (tx) => tx.user.create({ data: { id: USER_B, idpId: "kc-exit-b", email: "b@x.com" } }));
    assetA = (await withTenant(ORG_A, (tx) => tx.asset.create({ data: { id: "asset_exit_a_1", organizationId: ORG_A, type: "ipv4", canonicalIdentifier: "10.9.9.9", lifecycleState: "active", verificationState: "verified" } }))).id;
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("scan → manifest → findings → report traces every finding to its asset and scan", async () => {
    scanId = (await createScanFromAssets(ctxA, { name: "exit scan", assetIds: [assetA] })).id;
    const { findings } = await runScanWithSimulatedScanner(ctxA, scanId);
    expect(findings).toBeGreaterThanOrEqual(1);
    const scan = await getScan(ctxA, scanId);
    expect(scan?.status).toBe("COMPLETED");
    const fRows = await withTenant(ORG_A, (tx) => tx.finding.findMany({ where: { scanId } }));
    expect(fRows.length).toBeGreaterThanOrEqual(1);
    for (const f of fRows) {
      expect(f.scanId).toBe(scanId);
      expect(scan?.targets.some((t) => t.assetId === f.assetId)).toBe(true);
    }
  });

  it("report is NOT final until QA-attested (prod)", async () => {
    const report = await buildReport(ctxA, scanId);
    expect(isReportFinal(report)).toBe(false);
    await submitReport(ctxA, report.id);
    const attested = await attestReport(staffA, report.id);
    expect(isReportFinal(attested!)).toBe(true);
  });

  it("cross-tenant isolation: org B sees none of org A's scans, findings, or reports", async () => {
    expect(await getScan(ctxB, scanId)).toBeNull();
    const bFindings = await withTenant(ORG_B, (tx) => tx.finding.findMany({ where: { scanId } }));
    expect(bFindings).toHaveLength(0);
    const bReports = await withTenant(ORG_B, (tx) => tx.report.findMany({}));
    expect(bReports).toHaveLength(0);
  });

  it("every Phase 3 contract path maps to a route file", async () => {
    const file = fs.readFileSync(path.join(process.cwd(), "spec", "openapi.yaml"), "utf-8");
    const spec = yaml.load(file) as { paths: Record<string, any> };
    const routeDir = path.join(process.cwd(), "src", "app", "api", "v1");
    const routeFiles = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") routeFiles.add(full);
      }
    };
    walk(routeDir);
    const phase3Paths = Object.keys(spec.paths).filter((p) => /^\/(scans|reports)(\/|$)/.test(p));
    expect(phase3Paths.length).toBeGreaterThanOrEqual(5);
    for (const p of phase3Paths) {
      const segments = p.split("/").filter(Boolean).map((s) => (s.startsWith("{") ? `[${s.slice(1, -1)}]` : s));
      const expected = path.join(routeDir, ...segments, "route.ts");
      expect(routeFiles.has(expected), `no route file for ${p}`).toBe(true);
    }
  });
});
