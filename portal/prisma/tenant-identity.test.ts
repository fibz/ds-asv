import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

// Fixed ids so the RLS tenant context can be bound BEFORE each create: RLS
// WITH CHECK requires the inserted org/membership row to belong to
// app.tenant_id, and the context must be set on the same transaction the
// create runs in.
const ORG_QSA = "org_qsa_0001";
const ORG_MERCHANT = "org_merchant_0002";
const ORG_MEM = "org_membership_0003";
const USER_1 = "user_1_000001";

/**
 * Runs `fn` on a dedicated transaction connection with the RLS tenant context
 * set (same shape as tenant.test.ts / tenant-isolation.test.ts).
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
 * Wipe as the ADMIN role: asv_app has no DELETE grant on User at all, and RLS
 * hides tenant rows from uncontexted DELETEs (they silently match 0 rows), so
 * teardown must bypass RLS to actually clean the tables between runs.
 *
 * The wipe is SCOPED to this suite's fixed ids: the DB is shared with every
 * other vitest file (they run in parallel workers), so a global DELETE FROM
 * would race with their seeding and tear down their rows mid-run.
 */
async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    // deleting the orgs cascades to their contacts / memberships / audit rows
    await admin.query(`DELETE FROM "Organization" WHERE id = ANY($1::text[])`, [
      [ORG_QSA, ORG_MERCHANT, ORG_MEM],
    ]);
    await admin.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [[USER_1]]);
  } finally {
    await admin.end();
  }
}

describe("tenant identity models", () => {
  beforeAll(adminWipe);

  it("creates an organization with a parent (QSA nesting)", async () => {
    // the org is the tenant boundary: both rows must belong to the session
    // tenant (QSA creates itself, then a direct child with parentOrgId = QSA)
    await withTenant(ORG_QSA, async (tx) => {
      const qsa = await tx.organization.create({ data: { id: ORG_QSA, name: "QSA" } });
      const merchant = await tx.organization.create({
        data: { id: ORG_MERCHANT, name: "Merchant", parentOrgId: ORG_QSA },
      });
      expect(merchant.parentOrgId).toBe(qsa.id);
    });
  });

  it("creates a membership with a role", async () => {
    await withTenant(ORG_MEM, async (tx) => {
      const org = await tx.organization.create({ data: { id: ORG_MEM, name: "Org" } });
      // User has no RLS policy (identity table, fail-closed grants: SELECT +
      // INSERT only); the membership row itself must belong to the session
      // tenant, so it is created inside the contexted transaction.
      const user = await tx.user.create({
        data: { id: USER_1, idpId: "kc-user-1", email: "a@b.com" },
      });
      const m = await tx.organizationMembership.create({
        data: { userId: user.id, organizationId: org.id, role: "organization_owner" },
      });
      expect(m.role).toBe("organization_owner");
    });
  });

  afterAll(async () => {
    await adminWipe();
    await prisma.$disconnect();
  });
});
