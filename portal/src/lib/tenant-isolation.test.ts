import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

/**
 * Phase 1 EXIT CRITERION (spec §10): "tenants cannot read/mutate another
 * tenant's objects" — including guessed ids, cross-tenant writes, unset
 * context, audit-event isolation, and the Organization parent/child policy.
 *
 * RLS wiring lives in migrations (20260829141402_rls, 20260829142337_rls_
 * hardening): every tenant table carries a policy matching
 * `"organizationId" = current_setting('app.tenant_id', true)` (Organization
 * matches `id`/`parentOrgId`), and asv_app has NO row-level privileges beyond
 * those policies (fail-closed grants). These tests prove the policies are
 * actually enforced end-to-end through the Prisma client the app uses.
 *
 * Context mechanics: `set_config(..., true)` is TRANSACTION-scoped, so every
 * tenant-scoped query runs inside `prisma.$transaction` with
 * `setRlsContext(orgId, tx)` — the context is only visible to `tx` calls on
 * that transaction's pinned connection (verified in Task 3).
 */

// Fixed ids make re-runs idempotent and the isolation assertions deterministic.
const ORG_A = "iso_org_aaaa_0001";
const ORG_B = "iso_org_bbbb_0002";
const ORG_A_CHILD = "iso_org_cccc_0003";
const ORG_UNRELATED = "iso_org_dddd_0004";
const USER_B = "iso_user_bbbb_0002";
const SEEDED_ORGS = [ORG_A, ORG_B, ORG_A_CHILD, ORG_UNRELATED];
const SEEDED_USERS = [USER_B];

/**
 * Runs `fn` on a dedicated transaction connection with the RLS tenant context
 * set (see the withTenant helper in tenant.test.ts for the reasoning).
 */
function withTenant<T>(
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(organizationId, tx);
    return fn(tx);
  });
}

/**
 * ADMIN connection (ADMIN_DATABASE_URL = `asv`, a superuser): bypasses RLS.
 * Used for scoped teardown (asv_app's uncontexted DELETEs match 0 rows because
 * RLS hides every row, and asv_app has no DELETE grant on User at all) and for
 * proof-of-absence counts that must NOT be filtered by RLS. Same pattern as
 * adminDeleteUsers in tenant.test.ts / adminQuery in audit.test.ts.
 */
async function adminQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    const res = await admin.query(sql, params);
    return res.rows as T[];
  } finally {
    await admin.end();
  }
}

/** Scoped teardown: deletes ONLY this suite's fixed ids (never other suites' rows). */
async function wipeSeeded(): Promise<void> {
  // deleting the orgs cascades to their contacts / audit events / memberships
  await adminQuery(`DELETE FROM "Organization" WHERE id = ANY($1::text[])`, [SEEDED_ORGS]);
  await adminQuery(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [SEEDED_USERS]);
}

describe("cross-tenant isolation (Phase 1 exit criterion)", () => {
  beforeAll(async () => {
    await wipeSeeded(); // leftovers from a previous crashed run

    // seed tenants A (with a child org), B, and an unrelated org. Every create
    // runs contexted: RLS WITH CHECK rejects tenant rows inserted without
    // app.tenant_id.
    await withTenant(ORG_A, async (tx) => {
      await tx.organization.create({ data: { id: ORG_A, name: "Tenant A" } });
      await tx.organization.create({
        data: { id: ORG_A_CHILD, name: "A-child", parentOrgId: ORG_A },
      });
      await tx.contact.create({
        data: { organizationId: ORG_A, type: "business", name: "A-contact", email: "a@a.com" },
      });
      await tx.auditEvent.create({
        data: { organizationId: ORG_A, actorUserId: "u-a", action: "audit.a.only", resourceType: "ScopeVersion" },
      });
    });
    await withTenant(ORG_B, async (tx) => {
      await tx.organization.create({ data: { id: ORG_B, name: "Tenant B" } });
      await tx.user.create({ data: { id: USER_B, idpId: "iso-kc-user-b", email: "b@b.com" } });
      await tx.organizationMembership.create({
        data: { userId: USER_B, organizationId: ORG_B, role: "security_admin" },
      });
      await tx.contact.create({
        data: { organizationId: ORG_B, type: "business", name: "B-contact", email: "b@b.com" },
      });
      await tx.auditEvent.create({
        data: { organizationId: ORG_B, actorUserId: "u-b", action: "audit.b.only", resourceType: "ScopeVersion" },
      });
    });
    await withTenant(ORG_UNRELATED, async (tx) => {
      await tx.organization.create({ data: { id: ORG_UNRELATED, name: "Unrelated" } });
    });
  });

  afterAll(async () => {
    await wipeSeeded();
    await prisma.$disconnect();
  });

  it("(a) tenant A sees ONLY its own contacts, never tenant B's", async () => {
    await withTenant(ORG_A, async (tx) => {
      const contacts = await tx.contact.findMany({ orderBy: { name: "asc" } });
      // exactly one row: A's own contact. B's contact row exists in the DB but
      // the policy hides it — this fails the moment RLS is off.
      expect(contacts.map((c) => c.name)).toEqual(["A-contact"]);
      // explicit WHERE on B's org id cannot fish out B's rows either
      expect(await tx.contact.findMany({ where: { organizationId: ORG_B } })).toHaveLength(0);
    });
  });

  it("(b) guessing another tenant's id yields no rows", async () => {
    await withTenant(ORG_A, async (tx) => {
      // an attacker who knows (or guesses) B's org id gets nothing back:
      // the policy ANDs with the session tenant on every read path. Every
      // target table HAS B rows seeded, so a leak would surface here.
      expect(await tx.contact.findMany({ where: { organizationId: ORG_B } })).toHaveLength(0);
      expect(await tx.auditEvent.findMany({ where: { organizationId: ORG_B } })).toHaveLength(0);
      expect(await tx.organization.findUnique({ where: { id: ORG_B } })).toBeNull();
      expect(
        await tx.organizationMembership.findMany({ where: { organizationId: ORG_B } })
      ).toHaveLength(0);
    });
  });

  it("(c) a cross-tenant INSERT (B's organizationId while contexted as A) is rejected by WITH CHECK", async () => {
    await expect(
      withTenant(ORG_A, async (tx) =>
        tx.contact.create({
          data: { organizationId: ORG_B, type: "business", name: "sneaky", email: "s@x.com" },
        })
      )
    ).rejects.toMatchObject({ code: "P2039" }); // Prisma code: new row violates row-level security policy
    // proof of absence via the ADMIN connection: the rejected row must not
    // exist anywhere in the table (an RLS-filtered count could hide it)
    const [row] = await adminQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM "Contact" WHERE email = $1`,
      ["s@x.com"]
    );
    expect(row.n).toBe(0);
  });

  it("(d) unset RLS context hides all tenant rows (secure default)", async () => {
    // deliberately NO set_config: app.tenant_id is unset, so every policy's
    // current_setting(...) matches nothing and the fail-closed grants mean
    // there is no context-free read path
    const contacts = await prisma.$transaction((tx) => tx.contact.findMany());
    expect(contacts).toHaveLength(0);
    const orgs = await prisma.$transaction((tx) => tx.organization.findMany());
    expect(orgs).toHaveLength(0);
    const audit = await prisma.$transaction((tx) => tx.auditEvent.findMany());
    expect(audit).toHaveLength(0);
  });

  it("(e) tenant A cannot read tenant B's audit events (and cannot write them)", async () => {
    await withTenant(ORG_A, async (tx) => {
      // seeded rows for BOTH tenants exist; A only sees its own
      const audit = await tx.auditEvent.findMany({ orderBy: { action: "asc" } });
      expect(audit.map((e) => e.action)).toEqual(["audit.a.only"]);
      // guessed-id audit read also returns nothing
      expect(await tx.auditEvent.findMany({ where: { organizationId: ORG_B } })).toHaveLength(0);
    });
    // audit writes are gated by the same WITH CHECK policy
    await expect(
      withTenant(ORG_A, async (tx) =>
        tx.auditEvent.create({
          data: { organizationId: ORG_B, actorUserId: "u-a", action: "sneaky", resourceType: "X" },
        })
      )
    ).rejects.toMatchObject({ code: "P2039" });
  });

  it("(f) org policy: tenant A sees its own org + direct children, never an unrelated org", async () => {
    await withTenant(ORG_A, async (tx) => {
      // own org row + its direct child; B and the unrelated org are invisible
      const orgs = await tx.organization.findMany({ orderBy: { id: "asc" } });
      expect(orgs.map((o) => o.id).sort()).toEqual([ORG_A, ORG_A_CHILD]);
      expect(await tx.organization.findUnique({ where: { id: ORG_B } })).toBeNull();
      expect(await tx.organization.findUnique({ where: { id: ORG_UNRELATED } })).toBeNull();
    });
    // an org that is neither the session tenant nor its direct child cannot be
    // created while contexted as A (WITH CHECK on Organization)
    await expect(
      withTenant(ORG_A, async (tx) =>
        tx.organization.create({ data: { id: ORG_UNRELATED, name: "Unrelated" } })
      )
    ).rejects.toMatchObject({ code: "P2039" });
    // ...and a child of B (parentOrgId = B) cannot be created by A either
    await expect(
      withTenant(ORG_A, async (tx) =>
        tx.organization.create({ data: { id: "iso_org_eeee_0005", name: "B-child", parentOrgId: ORG_B } })
      )
    ).rejects.toMatchObject({ code: "P2039" });
  });
});
