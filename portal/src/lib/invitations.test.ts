import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/prisma-client";
import { createInvitation, acceptInvitation } from "@/lib/invitations";
import type { Role } from "@/lib/tenant";

// Fixed ids make re-runs idempotent and the assertions deterministic.
const ORG_ID = "org_invite_0001";
const ORG_RACE = "org_invite_race";
const USER_ID = "user_invitee_0001";
const USER_RACE_A = "user_race_a";
const USER_RACE_B = "user_race_b";
const INVITEE_EMAIL = "new@user.com";

/**
 * RLS-aware test strategy (Task 6 controller ruling):
 * - Org + user seeding runs on the ADMIN connection: asv_app has no DELETE on
 *   "User" (fail-closed grants) and raw org/user seeding must not depend on a
 *   tenant context.
 * - The invitation flow itself runs as asv_app (DATABASE_URL). Both lib
 *   functions set the RLS context internally on their own transaction
 *   connection, so no caller-side context is needed — the tests therefore
 *   genuinely exercise the RLS policies (INSERT/UPDATE would fail with
 *   permission/with-check errors if the context handling were wrong).
 * - Teardown also uses the admin connection: Invitation has no DELETE grant
 *   for asv_app, and RLS hides tenant rows from uncontexted DELETEs.
 */
let admin: Client;

async function adminQuery(sql: string, params?: unknown[]): Promise<void> {
  await admin.query(sql, params);
}

async function wipeInviteRows(): Promise<void> {
  for (const orgId of [ORG_ID, ORG_RACE]) {
    await adminQuery(`DELETE FROM "Invitation" WHERE "organizationId" = $1`, [orgId]);
    await adminQuery(`DELETE FROM "OrganizationMembership" WHERE "organizationId" = $1`, [orgId]);
    await adminQuery(`DELETE FROM "Organization" WHERE id = $1`, [orgId]);
  }
  for (const userId of [USER_ID, USER_RACE_A, USER_RACE_B]) {
    await adminQuery(`DELETE FROM "User" WHERE id = $1`, [userId]);
  }
}

async function seedOrgAndUser(): Promise<void> {
  await adminQuery(
    `INSERT INTO "Organization" (id, name, "createdAt", "updatedAt") VALUES ($1, $2, now(), now()) ON CONFLICT (id) DO NOTHING`,
    [ORG_ID, "Invite Org"]
  );
  await adminQuery(
    `INSERT INTO "User" (id, "idpId", email, "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now()) ON CONFLICT (id) DO NOTHING`,
    [USER_ID, "kc-invitee", INVITEE_EMAIL]
  );
}

/** Two distinct users sharing the invitation email, in a dedicated race org. */
async function seedRaceOrgAndUsers(): Promise<void> {
  await adminQuery(
    `INSERT INTO "Organization" (id, name, "createdAt", "updatedAt") VALUES ($1, $2, now(), now()) ON CONFLICT (id) DO NOTHING`,
    [ORG_RACE, "Invite Race Org"]
  );
  await adminQuery(
    `INSERT INTO "User" (id, "idpId", email, "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now()) ON CONFLICT (id) DO NOTHING`,
    [USER_RACE_A, "kc-race-a", INVITEE_EMAIL]
  );
  await adminQuery(
    `INSERT INTO "User" (id, "idpId", email, "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now()) ON CONFLICT (id) DO NOTHING`,
    [USER_RACE_B, "kc-race-b", INVITEE_EMAIL]
  );
}

/** Inserts an already-expired invitation directly (admin bypasses RLS). */
async function seedExpiredInvitation(tokenHash: string, role: string): Promise<void> {
  await adminQuery(
    `INSERT INTO "Invitation" (id, "organizationId", email, role, "tokenHash", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, $5, now() - interval '1 hour', now())`,
    [randomBytes(12).toString("hex"), ORG_ID, INVITEE_EMAIL, role, tokenHash]
  );
}

/** Inserts an already-claimed invitation (acceptedAt set) directly. */
async function seedClaimedInvitation(tokenHash: string): Promise<void> {
  await adminQuery(
    `INSERT INTO "Invitation" (id, "organizationId", email, role, "tokenHash", "expiresAt", "acceptedAt", "createdAt")
     VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour', now(), now())`,
    [randomBytes(12).toString("hex"), ORG_ID, INVITEE_EMAIL, "scan_operator", tokenHash]
  );
}

describe("invitations (single-use, expiring, RLS-scoped)", () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
    await admin.connect();
    await wipeInviteRows();
    await seedOrgAndUser();
  });

  afterAll(async () => {
    await wipeInviteRows();
    await admin.end();
    await prisma.$disconnect();
  });

  it("creates a tenant-scoped single-use invitation and accepts it once", async () => {
    const inv = await createInvitation(ORG_ID, INVITEE_EMAIL, "security_admin");
    expect(inv.token).toBeTruthy();

    // RLS secure default: with no tenant context the invitation row is invisible.
    const unseen = await prisma.$transaction((tx) => tx.invitation.findMany());
    expect(unseen).toHaveLength(0);

    const membership = await acceptInvitation(inv.token, USER_ID, INVITEE_EMAIL);
    expect(membership.role).toBe("security_admin");
    expect(membership.organizationId).toBe(ORG_ID);

    // second accept must fail (single-use: the atomic claim gate rejects it)
    await expect(acceptInvitation(inv.token, USER_ID, INVITEE_EMAIL)).rejects.toThrow();
  });

  it("rejects an already-expired invitation", async () => {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await seedExpiredInvitation(tokenHash, "asset_manager");
    await expect(acceptInvitation(token, USER_ID, INVITEE_EMAIL)).rejects.toThrow(
      /expired|Invalid/i
    );
  });

  it("rejects an unknown token", async () => {
    await expect(acceptInvitation("no-such-token", USER_ID, INVITEE_EMAIL)).rejects.toThrow();
  });

  it("rejects a role outside the 6-role union at create time", async () => {
    await expect(
      createInvitation(ORG_ID, "bad@user.com", "super_admin" as Role)
    ).rejects.toThrow(/Invalid role/i);
  });

  it("rejects redemption by a user whose email differs from the invitation email", async () => {
    // invitation intended for alice@corp.com, redeemed by the seeded user
    const inv = await createInvitation(ORG_ID, "alice@corp.com", "asset_manager");
    await expect(acceptInvitation(inv.token, USER_ID, INVITEE_EMAIL)).rejects.toThrow(
      /email/i
    );
  });

  it("fails the atomic claim gate when the invitation was already claimed", async () => {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await seedClaimedInvitation(tokenHash);
    // read-time acceptedAt is deliberately NOT checked: the conditional
    // updateMany (acceptedAt: null) is the single-use enforcement, and it must
    // reject an invitation that was already claimed.
    await expect(acceptInvitation(token, USER_ID, INVITEE_EMAIL)).rejects.toThrow();
  });

  it("concurrent redemption of one token admits exactly one user", async () => {
    await seedRaceOrgAndUsers();
    const inv = await createInvitation(ORG_RACE, INVITEE_EMAIL, "scan_operator");

    // Two DIFFERENT users race to redeem the same token. The atomic claim gate
    // (updateMany where acceptedAt: null) serializes on the row lock, so at
    // READ COMMITTED exactly one transaction gets count = 1. (The membership
    // @@unique([userId, organizationId]) would NOT catch this case — the users
    // are distinct, so the conflict only shows up between the two claims.)
    const results = await Promise.allSettled([
      acceptInvitation(inv.token, USER_RACE_A, INVITEE_EMAIL),
      acceptInvitation(inv.token, USER_RACE_B, INVITEE_EMAIL),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});
