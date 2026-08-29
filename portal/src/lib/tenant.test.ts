import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma-client";
import { resolveTenantContext, setRlsContext, getAppMode } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

// Fixed ids make re-runs idempotent and the isolation assertions deterministic.
const ORG_A = "org_aaaa_0001";
const ORG_B = "org_bbbb_0002";
const ORG_A_CHILD = "org_cccc_0003";
const USER_A = "user_aaaa_0001";
const USER_B = "user_bbbb_0002";

/**
 * Runs `fn` on a dedicated transaction connection with the RLS tenant context set.
 *
 * `set_config('app.tenant_id', $1, true)` is TRANSACTION-scoped: outside an
 * explicit transaction the value reverts as soon as the statement commits
 * (verified against the live DB), and Prisma's pooled client does not guarantee
 * that a later query reuses the same connection. `prisma.$transaction` pins all
 * `tx.*` calls to one connection, so the context is guaranteed to be visible to
 * every query inside `fn`.
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

/** Context-scoped teardown: RLS hides tenant-table rows from uncontexted DELETEs. */
async function wipeTenant(organizationId: string): Promise<void> {
  await withTenant(organizationId, async (tx) => {
    await tx.contact.deleteMany({ where: { organizationId } });
    await tx.organizationMembership.deleteMany({ where: { organizationId } });
    await tx.organization.deleteMany({ where: { id: organizationId } });
  });
}

describe("tenant context + row-level security", () => {
  beforeAll(async () => {
    // wipe any leftovers from a previous run
    await wipeTenant(ORG_A_CHILD);
    await wipeTenant(ORG_A);
    await wipeTenant(ORG_B);
    await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });

    // seed tenant A and tenant B (org + user + membership + contact each)
    await withTenant(ORG_A, async (tx) => {
      await tx.organization.create({ data: { id: ORG_A, name: "Tenant A" } });
      await tx.user.create({ data: { id: USER_A, idpId: "kc-user-a", email: "a@a.com" } });
      await tx.organizationMembership.create({
        data: { userId: USER_A, organizationId: ORG_A, role: "organization_owner" },
      });
      await tx.contact.create({
        data: { organizationId: ORG_A, type: "business", name: "A-contact", email: "a@a.com" },
      });
    });
    await withTenant(ORG_B, async (tx) => {
      await tx.organization.create({ data: { id: ORG_B, name: "Tenant B" } });
      await tx.user.create({ data: { id: USER_B, idpId: "kc-user-b", email: "b@b.com" } });
      await tx.organizationMembership.create({
        data: { userId: USER_B, organizationId: ORG_B, role: "security_admin" },
      });
      await tx.contact.create({
        data: { organizationId: ORG_B, type: "business", name: "B-contact", email: "b@b.com" },
      });
    });
  });

  afterAll(async () => {
    await wipeTenant(ORG_A_CHILD);
    await wipeTenant(ORG_A);
    await wipeTenant(ORG_B);
    await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
    await prisma.$disconnect();
  });

  it("exposes the app mode from the environment", () => {
    expect(getAppMode()).toBe("dev");
  });

  it("resolveTenantContext derives org + role from the membership, never from client input", async () => {
    const ctx = await resolveTenantContext(USER_A);
    expect(ctx).toEqual({
      userId: USER_A,
      organizationId: ORG_A,
      role: "organization_owner",
      isStaff: false,
      appMode: getAppMode(),
    });
  });

  it("resolveTenantContext throws for a user with no active membership", async () => {
    await expect(resolveTenantContext("user_none_9999")).rejects.toThrow(
      "No active organization membership"
    );
  });

  it("tenant A sees only its own rows and NOT tenant B's", async () => {
    await withTenant(ORG_A, async (tx) => {
      const contacts = await tx.contact.findMany({ orderBy: { name: "asc" } });
      expect(contacts.map((c) => c.name)).toEqual(["A-contact"]);

      const memberships = await tx.organizationMembership.findMany();
      expect(memberships.map((m) => m.organizationId)).toEqual([ORG_A]);
    });
  });

  it("guessing another tenant's id yields no rows", async () => {
    await withTenant(ORG_A, async (tx) => {
      const guessed = await tx.contact.findMany({ where: { organizationId: ORG_B } });
      expect(guessed).toHaveLength(0);
      const guessedOrg = await tx.organization.findUnique({ where: { id: ORG_B } });
      expect(guessedOrg).toBeNull();
    });
  });

  it("cross-tenant writes are rejected by the WITH CHECK policy", async () => {
    await expect(
      withTenant(ORG_A, async (tx) =>
        tx.contact.create({
          data: { organizationId: ORG_B, type: "business", name: "sneaky", email: "s@x.com" },
        })
      )
    ).rejects.toThrow();
  });

  it("unset RLS context hides all rows (secure default)", async () => {
    // deliberately NO set_config in this transaction: the session var is unset
    const contacts = await prisma.$transaction((tx) => tx.contact.findMany());
    expect(contacts).toHaveLength(0);
    const orgs = await prisma.$transaction((tx) => tx.organization.findMany());
    expect(orgs).toHaveLength(0);
  });

  it("org policy: own org + direct children visible, foreign org invisible", async () => {
    // QSA flow: tenant A creates a child org (parentOrgId = tenant)
    await withTenant(ORG_A, async (tx) => {
      await tx.organization.create({
        data: { id: ORG_A_CHILD, name: "A-child", parentOrgId: ORG_A },
      });
    });
    await withTenant(ORG_A, async (tx) => {
      const orgs = await tx.organization.findMany({ orderBy: { id: "asc" } });
      expect(orgs.map((o) => o.id).sort()).toEqual([ORG_A, ORG_A_CHILD]);
    });
    // an org that is neither the session tenant nor a child of it cannot be created
    await expect(
      withTenant(ORG_A, async (tx) =>
        tx.organization.create({ data: { id: "org_zzzz_0009", name: "Z" } })
      )
    ).rejects.toThrow();
  });
});
