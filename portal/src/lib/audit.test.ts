import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { recordAudit, listAuditEvents } from "@/lib/audit";
import { prisma } from "@/lib/prisma-client";
import type { TenantContext } from "@/lib/tenant";

const ctx: TenantContext = {
  userId: "u1",
  organizationId: "o1",
  role: "security_admin",
  isStaff: false,
  appMode: "prod",
};

/**
 * AuditEvent is RLS-protected: asv_app's uncontexted DELETE matches 0 rows
 * (every row is hidden), so teardown must run as the ADMIN role to actually
 * wipe rows (same pattern as adminDeleteUsers in tenant.test.ts). The admin
 * connection also seeds the FK target for the fixed ctx.organizationId ("o1"):
 * AuditEvent.organizationId references Organization.id, and the test DB holds
 * no orgs between runs.
 */
async function adminQuery(sql: string, params?: unknown[]): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(sql, params);
  } finally {
    await admin.end();
  }
}

describe("audit", () => {
  beforeAll(async () => {
    // wipe any AuditEvent leftovers from a previous (crashed) run. SCOPED to
    // this suite's org: every vitest file shares the DB and runs in parallel,
    // so a global DELETE FROM "AuditEvent" would tear down rows that
    // concurrently-running suites (e.g. tenant-isolation.test.ts) just seeded.
    await adminQuery(`DELETE FROM "AuditEvent" WHERE "organizationId" = 'o1'`);
    // the FK target for ctx.organizationId must exist before any insert;
    // "updatedAt" is NOT NULL with no DB default (Prisma fills it client-side)
    await adminQuery(
      `INSERT INTO "Organization" (id, name, "updatedAt") VALUES ('o1', 'Audit Test Org', now()) ON CONFLICT (id) DO NOTHING`
    );
  });

  it("records an append-only audit event", async () => {
    const ev = await recordAudit(
      ctx,
      "scope.submit",
      "ScopeVersion",
      "sv1",
      { status: "draft" },
      { status: "submitted" },
      "customer approved"
    );
    // the returned row IS the persisted INSERT ... RETURNING row
    expect(ev.id).toBeTruthy();
    expect(ev.action).toBe("scope.submit");
    expect(ev.organizationId).toBe("o1");
    expect(ev.after).toEqual({ status: "submitted" });
    // remaining fields, so the test genuinely proves the whole event record
    expect(ev.actorUserId).toBe("u1");
    expect(ev.resourceType).toBe("ScopeVersion");
    expect(ev.resourceId).toBe("sv1");
    expect(ev.before).toEqual({ status: "draft" });
    expect(ev.reason).toBe("customer approved");
  });

  // R4 (controller ruling): the brief's appended tests referenced fixtures
  // (org "org_audit_0001", action "test.audit") that don't exist in this file.
  // Adapted to the live fixtures — org "o1", the shared `ctx`, and this file's
  // adminQuery helper — while keeping the assertions' intent. Nested inside
  // this describe so the parent beforeAll (wipe o1 events + seed org o1) has
  // already run and the parent afterAll (org o1 cascade) runs last.
  describe("listAuditEvents", () => {
    let newestId: string;

    beforeAll(async () => {
      // Seed recognizable events in org o1. The last write (sv2) is the newest
      // row, so newest-first ordering is assertable. "team.member_added" is a
      // decoy for the filter assertion (action filter must exclude it).
      await recordAudit(ctx, "team.member_added", "OrganizationMembership", "om1");
      await recordAudit(
        ctx,
        "scope.submit",
        "ScopeVersion",
        "sv1",
        { status: "draft" },
        { status: "submitted" },
        "r4-seed"
      );
      const ev2 = await recordAudit(
        ctx,
        "scope.submit",
        "ScopeVersion",
        "sv2",
        { status: "draft" },
        { status: "submitted" }
      );
      newestId = ev2.id;
      // R4: second org row for the tenant-scope case (same adminQuery pattern).
      await adminQuery(
        `INSERT INTO "Organization" (id, name, "updatedAt") VALUES ('o2', 'Audit Test Org 2', now()) ON CONFLICT (id) DO NOTHING`
      );
    });

    afterAll(async () => {
      await adminQuery(`DELETE FROM "Organization" WHERE id = 'o2'`);
    });

    it("lists org events newest-first and filters by action/resourceType", async () => {
      const all = await listAuditEvents(ctx, {});
      expect(all.events.length).toBeGreaterThanOrEqual(1);
      // newest-first: the last write of this suite is the first row
      expect(all.events[0].id).toBe(newestId);
      const filtered = await listAuditEvents(ctx, { action: "scope.submit" });
      expect(filtered.events.length).toBeGreaterThanOrEqual(1);
      expect(filtered.events.every((e) => e.action === "scope.submit")).toBe(true);
      // the decoy action is genuinely excluded
      expect(filtered.events.some((e) => e.action === "team.member_added")).toBe(false);
      const byType = await listAuditEvents(ctx, { resourceType: "ScopeVersion" });
      expect(byType.events.length).toBeGreaterThanOrEqual(1);
      expect(byType.events.every((e) => e.resourceType === "ScopeVersion")).toBe(true);
    });

    it("paginates with cursor and caps limit at 100", async () => {
      const page1 = await listAuditEvents(ctx, { limit: 1 });
      expect(page1.events).toHaveLength(1);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await listAuditEvents(ctx, { limit: 1, cursor: page1.nextCursor! });
      expect(page2.events).toHaveLength(1);
      expect(page2.events[0].id).not.toBe(page1.events[0].id);
      await expect(listAuditEvents(ctx, { limit: 500 })).rejects.toThrow(/limit/);
    });

    it("is tenant-scoped: another org sees none of our events", async () => {
      const o2ctx: TenantContext = {
        userId: "u-other",
        organizationId: "o2",
        role: "organization_owner",
        isStaff: false,
        appMode: "prod",
      };
      const result = await listAuditEvents(o2ctx, { action: "scope.submit" });
      expect(result.events).toHaveLength(0);
    });
  });

  afterAll(async () => {
    // deleting the org cascades to its AuditEvent rows (onDelete: Cascade)
    await adminQuery(`DELETE FROM "Organization" WHERE id = 'o1'`);
    await prisma.$disconnect();
  });
});
