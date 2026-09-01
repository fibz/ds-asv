import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets, transitionScanStatus } from "@/lib/scan/service";
import { ingestFindings } from "@/lib/scan/findings";
import { raiseDispute, moderateDispute, DisputeGuardError, listDisputes } from "./service";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_scope_disp_0001";
const USER = "user_scope_disp_0001";
const STAFF = "user_scope_disp_0002";
const ASSET = "asset_scope_disp_1";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

// Non-staff owner context (matches what resolveTenantContext would return:
// isStaff is always false — tenant.ts). The prod staff gate in
// moderateDispute reads the ENV via getAppMode(), NOT ctx.appMode, so the
// moderation test stubs APP_MODE=prod around the calls.
const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "organization_owner", isStaff: false, appMode: "dev" };
// Staff ctx is constructed directly — resolveTenantContext can never yield
// isStaff: true (tenant.ts:81).
const staffCtx: TenantContext = { userId: STAFF, organizationId: ORG, role: "report_viewer", isStaff: true, appMode: "dev" };

let scanId = "";
let findingId = "";

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const t of ["Dispute", "Finding", "ScanTarget", "Scan", "ScopeItem", "ScopeVersion", "ScopeSet", "AuditEvent", "Asset"]) {
      await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [ORG]);
    }
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    for (const u of [USER, STAFF]) await admin.query(`DELETE FROM "User" WHERE id = $1`, [u]);
  } finally { await admin.end(); }
}

// Seed org/user/asset + a COMPLETED scan with one ingested finding (the
// finding every dispute attaches to). The scope set/version submit/approve
// round-trip is defensive (scan creation's prod gate reads the ENV, which is
// dev here) but mirrors the eventual prod flow — keep it.
async function buildScanAndFinding(): Promise<void> {
  const { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion } = await import("@/lib/scope/service");
  const set = await createScopeSet(ctx, { name: "Disc" });
  const version = await createScopeVersion(ctx, set.id, { assetIds: [ASSET] });
  await submitScopeVersion(ctx, version.id);
  await approveScopeVersion(ctx, version.id);
  const scan = await createScanFromAssets(ctx, { name: "d", assetIds: [ASSET] });
  scanId = scan.id;
  await transitionScanStatus(ctx, scanId, "RUNNING");
  await transitionScanStatus(ctx, scanId, "COMPLETED");
  const { count } = await ingestFindings(ctx, scanId, [
    { assetId: ASSET, qid: "q1", severity: "4", title: "Weak TLS" },
  ]);
  expect(count).toBe(1);
  findingId = (await prisma.$transaction(async (tx) => {
    await setRlsContext(ORG, tx);
    return (await tx.finding.findFirst({ where: { scanId } }))!;
  })).id;
}

beforeAll(async () => {
  await adminWipe();
  await withTenant(ORG, (tx) => tx.organization.create({ data: { id: ORG, name: "Dispute Org" } }));
  await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-disp-owner", email: "o@x.com" } }));
  await withTenant(ORG, (tx) => tx.user.create({ data: { id: STAFF, idpId: "kc-disp-staff", email: "s@x.com" } }));
  await withTenant(ORG, (tx) => tx.asset.create({
    data: { id: ASSET, organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.9.9.9", lifecycleState: "active", verificationState: "verified" },
  }));
  await buildScanAndFinding();
});
afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

describe("dispute service", () => {
  it("raises a dispute with justification and lists it", async () => {
    const d = await raiseDispute(ctx, findingId, { justification: "not our host" });
    expect(d.status).toBe("open");
    expect(d.justification).toBe("not our host");
    const all = await listDisputes(ctx, { findingId });
    expect(all.some((x) => x.id === d.id)).toBe(true);
  });

  it("guards justification shape and unknown findings", async () => {
    await expect(raiseDispute(ctx, findingId, { justification: "   " }))
      .rejects.toBeInstanceOf(DisputeGuardError);
    await expect(raiseDispute(ctx, findingId, { justification: "x".repeat(2001) }))
      .rejects.toBeInstanceOf(DisputeGuardError);
    await expect(raiseDispute(ctx, "finding_missing_1", { justification: "x" }))
      .rejects.toThrow(/Finding not found/);
  });

  it("moderates an open dispute; guards states and prod staff", async () => {
    const d = await raiseDispute(ctx, findingId, { justification: "dispute" });
    // The prod staff gate reads the ENV (getAppMode()), not ctx.appMode —
    // force prod for the moderation assertions, like scan/service.test.ts.
    vi.stubEnv("APP_MODE", "prod");
    try {
      // non-staff owner is rejected in prod even though the RBAC route gate
      // (dispute.moderate → owner/security_admin) would have allowed them
      await expect(moderateDispute(ctx, d.id, { status: "rejected", note: "no" }))
        .rejects.toThrowError(/staff|prod/i);
      const resolved = await moderateDispute(staffCtx, d.id, { status: "resolved", note: "confirmed" });
      expect(resolved?.status).toBe("resolved");
      expect(resolved?.resolutionNote).toBe("confirmed");
      expect(resolved?.moderatedById).toBe(STAFF);
      // already moderated — state guard fires regardless of staff status
      await expect(moderateDispute(staffCtx, d.id, { status: "rejected", note: "again" }))
        .rejects.toThrowError(/only open disputes/i);
    } finally {
      vi.unstubAllEnvs();
    }
    // moderation is audited
    const audits = await withTenant(ORG, (tx) =>
      tx.auditEvent.findMany({ where: { action: "finding.dispute.moderated", resourceId: d.id } })
    );
    expect(audits.length).toBe(1);
  });
});