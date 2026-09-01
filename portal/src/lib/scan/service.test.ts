import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets, listScans, getScan, transitionScanStatus, ScanGuardError } from "@/lib/scan/service";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_scan_svc_0001";
const ORG2 = "org_scan_svc_0002";
const USER = "user_scan_svc_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "scan_operator", isStaff: false, appMode: "prod" };
const ctx2: TenantContext = { userId: USER, organizationId: ORG2, role: "scan_operator", isStaff: false, appMode: "prod" };

let assetA = ""; let assetB = "";

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG, ORG2]) {
      for (const t of ["Finding", "ScanTarget", "Scan", "ReportAttestation", "Report", "AuditEvent", "Asset"]) {
        await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [o]);
      }
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("scan service", () => {
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG, ORG2]) await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Scan ${o}` } }));
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-scan-svc", email: "s@x.com" } }));
    await withTenant(ORG, async (tx) => {
      assetA = (await tx.asset.create({ data: { id: "asset_scan_svc_a", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.0.0.5", lifecycleState: "active", verificationState: "verified" } })).id;
      assetB = (await tx.asset.create({ data: { id: "asset_scan_svc_b", organizationId: ORG, type: "fqdn", canonicalIdentifier: "web.example.com", lifecycleState: "active", verificationState: "verified" } })).id;
    });
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("creates a scan with immutable targets snapshotting the selected assets", async () => {
    const scan = await createScanFromAssets(ctx, { name: "Quarterly ASV", assetIds: [assetA, assetB] });
    expect(scan.status).toBe("PENDING");
    expect(scan.targets.map((t) => t.canonicalIdentifier).sort()).toEqual(["10.0.0.5", "web.example.com"]);
    expect(scan.targets.every((t) => t.status === "pending")).toBe(true);
  });

  it("rejects empty selections and retired assets", async () => {
    await expect(createScanFromAssets(ctx, { name: "empty", assetIds: [] })).rejects.toThrow(/assetIds/);
    await withTenant(ORG, (tx) => tx.asset.update({ where: { id: assetA }, data: { lifecycleState: "retired" } }));
    await expect(createScanFromAssets(ctx, { name: "retired", assetIds: [assetA] })).rejects.toBeInstanceOf(ScanGuardError);
    await withTenant(ORG, (tx) => tx.asset.update({ where: { id: assetA }, data: { lifecycleState: "active" } }));
  });

  it("is tenant-scoped: other org cannot see or create against our assets", async () => {
    const scan = await createScanFromAssets(ctx, { name: "scoped", assetIds: [assetA] });
    expect(await getScan(ctx2, scan.id)).toBeNull();
    await expect(createScanFromAssets(ctx2, { name: "x", assetIds: [assetA] })).rejects.toBeInstanceOf(ScanGuardError);
  });

  it("transitions status with valid moves only", async () => {
    const scan = await createScanFromAssets(ctx, { name: "status flow", assetIds: [assetB] });
    const running = await transitionScanStatus(ctx, scan.id, "RUNNING");
    expect(running?.status).toBe("RUNNING");
    const done = await transitionScanStatus(ctx, scan.id, "COMPLETED");
    expect(done?.status).toBe("COMPLETED");
    expect(done?.completedAt).not.toBeNull();
    await expect(transitionScanStatus(ctx, scan.id, "RUNNING")).rejects.toThrow(/transition/);
  });

  it("audits scan.created and scan.status.updated", async () => {
    const scan = await createScanFromAssets(ctx, { name: "audited", assetIds: [assetB] });
    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { action: { in: ["scan.created", "scan.status.updated"] }, resourceId: scan.id } }));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  // Gate runs inside this describe so it executes BEFORE the afterAll wipe (a
  // top-level describe would run after adminWipe deleted the org/assets).
  describe("scan creation scope gate (prod)", () => {
    it("rejects unapproved-scope assets in prod, allows approved ones", async () => {
      const { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion } = await import("@/lib/scope/service");
      const set = await createScopeSet(ctx, { name: "Gated" });
      const version = await createScopeVersion(ctx, set.id, { assetIds: [assetA] });
      await submitScopeVersion(ctx, version.id);
      await approveScopeVersion(ctx, version.id);
      // ctx.appMode is "prod" but the gate reads the ENV via getAppMode() (defaults "dev"); force prod.
      vi.stubEnv("APP_MODE", "prod");
      try {
        // assetA is in the approved scope version → ok; assetB is not → rejected
        await expect(createScanFromAssets(ctx, { name: "ok", assetIds: [assetA] })).resolves.toBeTruthy();
        await expect(createScanFromAssets(ctx, { name: "bad", assetIds: [assetB] })).rejects.toThrowError(/approved scope version/i);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});