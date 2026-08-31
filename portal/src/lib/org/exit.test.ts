import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { getOrgProfile, updateOrgProfile } from "@/lib/org/profile";
import { listTeamMembers, updateMemberRole, removeMember } from "@/lib/org/team";
import { recordSessionAccess, revokeSession, listActiveSessions, hashToken, isSessionBlocked } from "@/lib/org/sessions";
import { recordAudit, listAuditEvents } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG_A = "org_uc_exit_a_001";
const ORG_B = "org_uc_exit_b_001";
const OWNER_A = "user_uc_exit_owner_a";
const MEMBER_B = "user_uc_exit_member_b";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctxA: TenantContext = { userId: OWNER_A, organizationId: ORG_A, role: "organization_owner", isStaff: false, appMode: "prod" };
const ctxB: TenantContext = { userId: MEMBER_B, organizationId: ORG_B, role: "organization_owner", isStaff: false, appMode: "prod" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG_A, ORG_B]) {
      await admin.query(`DELETE FROM "Session" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "OrganizationMembership" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Contact" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id IN ($1, $2)`, [OWNER_A, MEMBER_B]);
  } finally { await admin.end(); }
}

describe("user center exit criteria", () => {
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG_A, ORG_B]) await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Exit ${o}` } }));
    await withTenant(ORG_A, (tx) => tx.user.create({ data: { id: OWNER_A, idpId: "kc-exit-a", email: "a@x.com" } }));
    await withTenant(ORG_B, (tx) => tx.user.create({ data: { id: MEMBER_B, idpId: "kc-exit-b", email: "b@x.com" } }));
    await withTenant(ORG_A, (tx) => tx.organizationMembership.create({ data: { userId: OWNER_A, organizationId: ORG_A, role: "organization_owner" } }));
    await withTenant(ORG_B, (tx) => tx.organizationMembership.create({ data: { userId: MEMBER_B, organizationId: ORG_B, role: "organization_owner" } }));
    await updateOrgProfile(ctxA, { name: "Exit Org A", contacts: [{ type: "security", name: "A", email: "sec@a.com" }] });
    await recordSessionAccess(ctxA, { tokenHash: hashToken("exit-tok") });
    await recordAudit(ctxA, "exit.test", "Test", "exit-1");
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("org B never sees org A's profile, members, sessions, or audit events", async () => {
    const profileB = await getOrgProfile(ctxB);
    expect(profileB.name).toBe("Exit org_uc_exit_b_001");
    expect(profileB.contacts.some((c) => c.email === "sec@a.com")).toBe(false);
    expect((await listTeamMembers(ctxB)).some((m) => m.email === "a@x.com")).toBe(false);
    expect((await listActiveSessions(ctxB)).some((s) => s.tokenHash === hashToken("exit-tok"))).toBe(false);
    expect((await listAuditEvents(ctxB, { action: "exit.test" })).events).toHaveLength(0);
    expect(await isSessionBlocked(ORG_B, hashToken("exit-tok"))).toBe(false);
  });

  it("org B cannot mutate org A's members", async () => {
    const memberA = (await listTeamMembers(ctxA)).find((m) => m.userId === OWNER_A)!;
    expect(await updateMemberRole(ctxB, memberA.id, "report_viewer")).toBeNull();
    expect(await removeMember(ctxB, memberA.id)).toBe(false);
  });

  it("revoking a session flips the blocked flag and removes it from the active list", async () => {
    const session = (await listActiveSessions(ctxA)).find((s) => s.tokenHash === hashToken("exit-tok"))!;
    await revokeSession(ctxA, session.id, "exit test");
    expect(await isSessionBlocked(ORG_A, hashToken("exit-tok"))).toBe(true);
    expect((await listActiveSessions(ctxA)).some((s) => s.id === session.id)).toBe(false);
  });

  it("every user-center contract path is implemented by a matching route", async () => {
    const file = fs.readFileSync(path.join(process.cwd(), "spec", "openapi.yaml"), "utf-8");
    const spec = yaml.load(file) as { paths: Record<string, any> };
    const routeDir = path.join(process.cwd(), "src", "app", "api", "v1");
    const routeFiles = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") routeFiles.add(full);
      }
    };
    walk(routeDir);
    const userCenterPaths = Object.keys(spec.paths).filter((p) =>
      /^\/(org|team|sessions|audit|invitations)(\/|$)/.test(p)
    );
    expect(userCenterPaths.length).toBeGreaterThanOrEqual(6);
    for (const p of userCenterPaths) {
      // R3: use ALL segments as the directory path (no slice). Param segments
      // keep their name ({memberId} -> [memberId]) to match the real layout:
      // team/members/[memberId]/route.ts, sessions/[sessionId]/revoke/route.ts.
      const segments = p.split("/").filter(Boolean).map((s) => (s.startsWith("{") ? `[${s.slice(1, -1)}]` : s));
      const expected = path.join(routeDir, ...segments, "route.ts");
      expect(routeFiles.has(expected), `no route file for ${p}`).toBe(true);
    }
  });
});
