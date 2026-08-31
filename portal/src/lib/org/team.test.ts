import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { listTeamMembers, updateMemberRole, removeMember, TeamGuardError } from "@/lib/org/team";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_team_0001";
const ORG2 = "org_team_0002";
const OWNER = "user_team_owner_01";
const MEMBER = "user_team_member_01";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ownerCtx: TenantContext = { userId: OWNER, organizationId: ORG, role: "organization_owner", isStaff: false, appMode: "prod" };
const memberCtx: TenantContext = { userId: MEMBER, organizationId: ORG, role: "report_viewer", isStaff: false, appMode: "prod" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG, ORG2]) {
      await admin.query(`DELETE FROM "Session" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "OrganizationMembership" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id IN ($1, $2)`, [OWNER, MEMBER]);
  } finally { await admin.end(); }
}

describe("team service", () => {
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG, ORG2]) await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Team ${o}` } }));
    await withTenant(ORG, async (tx) => {
      await tx.user.create({ data: { id: OWNER, idpId: "kc-team-owner", email: "owner@x.com" } });
      await tx.user.create({ data: { id: MEMBER, idpId: "kc-team-member", email: "member@x.com" } });
      await tx.organizationMembership.create({ data: { userId: OWNER, organizationId: ORG, role: "organization_owner" } });
      await tx.organizationMembership.create({ data: { userId: MEMBER, organizationId: ORG, role: "report_viewer" } });
    });
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("lists members with emails", async () => {
    const members = await listTeamMembers(ownerCtx);
    expect(members.map((m) => m.email).sort()).toEqual(["member@x.com", "owner@x.com"]);
  });

  it("owner changes a member role (audited)", async () => {
    const target = (await listTeamMembers(ownerCtx)).find((m) => m.userId === MEMBER)!;
    const updated = await updateMemberRole(ownerCtx, target.id, "asset_manager");
    expect(updated?.role).toBe("asset_manager");
    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { action: "member.role.updated", resourceId: target.id } }));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects an invalid role", async () => {
    const target = (await listTeamMembers(ownerCtx)).find((m) => m.userId === MEMBER)!;
    await expect(updateMemberRole(ownerCtx, target.id, "superadmin")).rejects.toThrow(/role/);
  });

  it("cannot demote the last organization_owner", async () => {
    const target = (await listTeamMembers(ownerCtx)).find((m) => m.userId === OWNER)!;
    await expect(updateMemberRole(ownerCtx, target.id, "report_viewer")).rejects.toBeInstanceOf(TeamGuardError);
    await expect(removeMember(ownerCtx, target.id)).rejects.toBeInstanceOf(TeamGuardError);
  });

  it("removing a member revokes their active sessions and audits", async () => {
    const { recordSessionAccess, hashToken } = await import("@/lib/org/sessions");
    await recordSessionAccess(memberCtx, { tokenHash: hashToken("member-tok") });
    const target = (await listTeamMembers(ownerCtx)).find((m) => m.userId === MEMBER)!;
    const removed = await removeMember(ownerCtx, target.id);
    expect(removed).toBe(true);
    const sessions = await withTenant(ORG, (tx) => tx.session.findMany({ where: { userId: MEMBER, revokedAt: null } }));
    expect(sessions).toHaveLength(0);
    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { action: "member.removed" } }));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("is tenant-scoped: other org cannot see or mutate our members", async () => {
    // R10 (plan-bug ruling): re-seed MEMBER's membership — the previous test
    // removed it, and this test must be order-independent. Upsert keyed on the
    // composite unique so it is safe under any shuffle order.
    await withTenant(ORG, (tx) => tx.organizationMembership.upsert({
      where: { userId_organizationId: { userId: MEMBER, organizationId: ORG } },
      update: { role: "report_viewer" },
      create: { userId: MEMBER, organizationId: ORG, role: "report_viewer" },
    }));
    const foreign: TenantContext = { userId: OWNER, organizationId: ORG2, role: "organization_owner", isStaff: false, appMode: "prod" };
    const ours = (await listTeamMembers(ownerCtx)).find((m) => m.userId === MEMBER)!;
    expect(await updateMemberRole(foreign, ours.id, "scan_operator")).toBeNull();
    expect(await removeMember(foreign, ours.id)).toBe(false);
  });
});
