import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_scan_rls_0001";
const USER = "user_scan_rls_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const t of ["Finding", "ScanTarget", "Scan", "ReportAttestation", "Report"]) {
      await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [ORG]);
    }
    await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("scan domain RLS", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Scan RLS Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-scan-rls", email: "s@x.com" } });
    });
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("asv_app cannot insert a Scan without tenant context (42501)", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Scan" ("id","organizationId","name","status") VALUES ($1,$2,$3,'PENDING')`,
        "scan_rls_x", ORG, "x"
      )
    ).rejects.toThrow(/42501/);
  });

  it("asv_app inserts all five tables inside tenant context", async () => {
    await withTenant(ORG, async (tx) => {
      const scan = await tx.scan.create({ data: { id: "scan_rls_1", organizationId: ORG, name: "RLS scan", requestedById: USER } });
      await tx.scanTarget.create({ data: { id: "st_rls_1", scanId: scan.id, assetId: "asset_rls_1", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.0.0.1" } });
      await tx.finding.create({ data: { id: "f_rls_1", scanId: scan.id, assetId: "asset_rls_1", organizationId: ORG, qid: "q1", severity: "4", title: "TLS weak" } });
      const report = await tx.report.create({ data: { id: "r_rls_1", scanId: scan.id, organizationId: ORG, status: "draft", summary: { hosts: 1 } } });
      await tx.reportAttestation.create({ data: { id: "ra_rls_1", reportId: report.id, organizationId: ORG, status: "draft", reviewedById: USER } });
    });
    const found = await withTenant(ORG, (tx) => tx.scan.findUnique({ where: { id: "scan_rls_1" } }));
    expect(found?.organizationId).toBe(ORG);
  });

  it("scan tables grants exclude DELETE for asv_app", async () => {
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "Scan" WHERE id = 'scan_rls_1'`)).rejects.toThrow(/permission denied/);
  });
});
