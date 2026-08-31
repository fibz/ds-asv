import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets } from "@/lib/scan/service";
import { ingestFindings, runScanWithSimulatedScanner } from "@/lib/scan/findings";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_findings_0001";
const USER = "user_findings_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}
const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "scan_operator", isStaff: false, appMode: "prod" };

let assetId = "";

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const t of ["Finding", "ScanTarget", "Scan", "AuditEvent", "Asset"]) {
      await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [ORG]);
    }
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("findings ingestion", () => {
  let scanId = "";
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, (tx) => tx.organization.create({ data: { id: ORG, name: "Findings Org" } }));
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-findings", email: "f@x.com" } }));
    assetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_findings_1", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.2.2.2", lifecycleState: "active", verificationState: "verified" } }))).id;
    scanId = (await createScanFromAssets(ctx, { name: "findings scan", assetIds: [assetId] })).id;
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("ingests findings deduped by (scanId, assetId, qid)", async () => {
    const f = [{ assetId, qid: "q-a", severity: "4", pciSeverity: "High", title: "Weak TLS", description: "d", threat: "t", impact: "i", result: "r" }];
    const first = await ingestFindings(ctx, scanId, f);
    expect(first.count).toBe(1);
    const again = await ingestFindings(ctx, scanId, f);
    expect(again.count).toBe(0); // duplicate is a no-op
    const rows = await withTenant(ORG, (tx) => tx.finding.findMany({ where: { scanId } }));
    expect(rows).toHaveLength(1);
  });

  it("rejects findings for assets outside the scan's targets", async () => {
    await expect(ingestFindings(ctx, scanId, [{ assetId: "asset_other_1", qid: "q-b", severity: "1", title: "x" }]))
      .rejects.toThrow(/asset/);
  });

  it("runScanWithSimulatedScanner issues a manifest, ingests, and completes the scan", async () => {
    const { findings } = await runScanWithSimulatedScanner(ctx, scanId);
    expect(findings).toBeGreaterThanOrEqual(1);
    const scan = await withTenant(ORG, (tx) => tx.scan.findUnique({ where: { id: scanId } }));
    expect(scan?.status).toBe("COMPLETED");
    expect(scan?.manifestIssuedAt).not.toBeNull();
  });
});
