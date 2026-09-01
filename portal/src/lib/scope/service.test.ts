import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext, resolveTenantContext } from "@/lib/tenant";
import type { TenantContext } from "@/lib/tenant";
import {
  ScopeGuardError,
  approveScopeVersion,
  assetInApprovedScope,
  createScopeSet,
  createScopeVersion,
  getScopeVersion,
  scopeContentHash,
  submitScopeVersion,
} from "./service";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_scope_svc_0001";
const ORG2 = "org_scope_svc_0002";
const USER = "user_scope_svc_0001";
const USER2 = "user_scope_svc_0002";

let ctxA: TenantContext;
let ctxB: TenantContext;

async function withTenant<T>(orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => { await setRlsContext(orgId, tx); return fn(tx); });
}

async function seed() {
  const pg = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await pg.connect();
  try {
    for (const id of [ORG, ORG2]) await pg.query(`DELETE FROM "Organization" WHERE id = $1`, [id]);
    for (const id of [USER, USER2]) await pg.query(`DELETE FROM "User" WHERE id = $1`, [id]);
    // Direct SQL inserts bypass Prisma's @updatedAt client-management: the
    // NOT NULL created/updated columns have no DB defaults and must be set
    // explicitly (verified against the live DB via information_schema).
    await pg.query(`INSERT INTO "Organization" (id, name, "createdAt", "updatedAt") VALUES ($1,$2,now(),now())`, [ORG, "Scope A"]);
    await pg.query(`INSERT INTO "Organization" (id, name, "createdAt", "updatedAt") VALUES ($1,$2,now(),now())`, [ORG2, "Scope B"]);
    await pg.query(`INSERT INTO "User" (id,"idpId",email,"createdAt","updatedAt") VALUES ($1,$2,$3,now(),now())`, [USER, "kc-scope-svc-1", "a@x.com"]);
    await pg.query(`INSERT INTO "User" (id,"idpId",email,"createdAt","updatedAt") VALUES ($1,$2,$3,now(),now())`, [USER2, "kc-scope-svc-2", "b@x.com"]);
    await pg.query(`INSERT INTO "OrganizationMembership" (id,"organizationId","userId",role,status,"updatedAt") VALUES ($1,$2,$3,$4,'active',now())`, ["om_scope_svc_1", ORG, USER, "organization_owner"]);
    await pg.query(`INSERT INTO "OrganizationMembership" (id,"organizationId","userId",role,status,"updatedAt") VALUES ($1,$2,$3,$4,'active',now())`, ["om_scope_svc_2", ORG2, USER2, "organization_owner"]);
    for (const a of [
      { id: "asset_scope_1", org: ORG, type: "ipv4", ci: "10.1.1.1" },
      { id: "asset_scope_2", org: ORG, type: "ipv4", ci: "10.1.1.2" },
      // asset_scope_3 is reserved for the gate test: test 3 approves a version
      // containing asset_scope_1, so the gate test's pre-approval `false`
      // assertion needs its own asset (shared approved state would make it true).
      { id: "asset_scope_3", org: ORG, type: "ipv4", ci: "10.1.1.3" },
      // asset_scope_4 is reserved for the supersession test: asset_scope_1 is
      // already approved inside "Gate Scope" by the earlier submit/approve
      // test, so the "removed from latest → out of scope" assertion needs a
      // fresh asset no other test ever approves.
      { id: "asset_scope_4", org: ORG, type: "ipv4", ci: "10.1.1.4" },
      // ORG2 asset for the cross-org exact-set guard test: an id belonging to
      // another org must be rejected by createScopeVersion up front.
      { id: "asset_scope_foreign", org: ORG2, type: "ipv4", ci: "10.2.1.1" },
    ]) {
      await pg.query(
        `INSERT INTO "Asset" (id,"organizationId",type,"canonicalIdentifier","lifecycleState","verificationState","updatedAt") VALUES ($1,$2,$3,$4,'active','verified',now())`,
        [a.id, a.org, a.type, a.ci]
      );
    }
  } finally {
    await pg.end();
  }
}

async function wipe() {
  const pg = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await pg.connect();
  try {
    await pg.query(`DELETE FROM "Authorization" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "ScopeItem" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "ScopeVersion" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "ScopeSet" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "Asset" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "OrganizationMembership" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "AuditEvent" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "Organization" WHERE id IN ($1,$2)`, [ORG, ORG2]);
    await pg.query(`DELETE FROM "User" WHERE id IN ($1,$2)`, [USER, USER2]);
  } finally {
    await pg.end();
  }
}

beforeAll(async () => {
  await wipe();
  await seed();
  ctxA = await resolveTenantContext(USER);
  ctxB = await resolveTenantContext(USER2);
});

afterAll(async () => { await wipe(); await prisma.$disconnect(); });

describe("scope service", () => {
  it("content hash is deterministic and order-independent", () => {
    const items = [{ type: "ipv4", canonicalIdentifier: "10.1.1.1" }, { type: "ipv4", canonicalIdentifier: "10.1.1.2" }];
    const reversed = [...items].reverse();
    expect(scopeContentHash(items)).toBe(scopeContentHash(reversed));
    expect(scopeContentHash(items).length).toBe(64);
  });

  it("creates a scope set and a draft version snapshotting assets", async () => {
    const set = await createScopeSet(ctxA, { name: "PCI Scope" });
    const version = await createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_1", "asset_scope_2"] });
    expect(version.status).toBe("draft");
    expect(version.items).toHaveLength(2);
    expect(version.contentHash).toBeTruthy();
    // Retired assets are skipped
    await withTenant(ORG, (tx) => tx.asset.update({ where: { id: "asset_scope_2" }, data: { lifecycleState: "retired" } }));
    const v2 = await createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_1", "asset_scope_2"] });
    const ids = v2.items.map((i) => i.assetId);
    expect(ids).not.toContain("asset_scope_2");
  });

  it("rejects asset ids from another organization (exact-set guard)", async () => {
    const set = await createScopeSet(ctxA, { name: "Guarded" });
    // asset_scope_foreign belongs to ORG2 — outside org A's row set, so the
    // exact-set guard must reject rather than snapshot a partial/foreign set.
    await expect(createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_1", "asset_scope_foreign"] })).rejects.toThrowError(ScopeGuardError);
  });

  it("submits and approves, freezing the version; gates transitions", async () => {
    const set = await createScopeSet(ctxA, { name: "Gate Scope" });
    const version = await createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_1"] });
    const submitted = await submitScopeVersion(ctxA, version.id);
    expect(submitted?.status).toBe("submitted");
    await expect(submitScopeVersion(ctxA, version.id)).rejects.toThrowError(ScopeGuardError);
    const approved = await approveScopeVersion(ctxA, version.id);
    expect(approved?.status).toBe("approved");
    expect(approved?.contentHash).toBe(version.contentHash);
    await expect(approveScopeVersion(ctxA, version.id)).rejects.toThrowError(ScopeGuardError);
    // cross-tenant
    const other = await getScopeVersion(ctxB, version.id);
    expect(other).toBeNull();
  });

  it("assetInApprovedScope reflects approval and tenant", async () => {
    const set = await createScopeSet(ctxA, { name: "Gated" });
    const version = await createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_3"] });
    expect(await assetInApprovedScope(ctxA, "asset_scope_3")).toBe(false);
    await submitScopeVersion(ctxA, version.id);
    await approveScopeVersion(ctxA, version.id);
    expect(await assetInApprovedScope(ctxA, "asset_scope_3")).toBe(true);
    expect(await assetInApprovedScope(ctxB, "asset_scope_3")).toBe(false);
  });

  it("assetInApprovedScope uses the latest approved version per scope set (supersession)", async () => {
    const set = await createScopeSet(ctxA, { name: "Superseding" });
    const v1 = await createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_4", "asset_scope_3"] });
    await submitScopeVersion(ctxA, v1.id);
    await approveScopeVersion(ctxA, v1.id);
    expect(await assetInApprovedScope(ctxA, "asset_scope_4")).toBe(true);
    expect(await assetInApprovedScope(ctxA, "asset_scope_3")).toBe(true);
    // v2 supersedes v1: asset_scope_4 is removed from the LATEST approved
    // version, so it must leave approved scope even though the older approved
    // v1 still lists it.
    const v2 = await createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_3"] });
    await submitScopeVersion(ctxA, v2.id);
    await approveScopeVersion(ctxA, v2.id);
    expect(await assetInApprovedScope(ctxA, "asset_scope_4")).toBe(false);
    expect(await assetInApprovedScope(ctxA, "asset_scope_3")).toBe(true);
    // cross-tenant still isolated
    expect(await assetInApprovedScope(ctxB, "asset_scope_3")).toBe(false);
  });
});