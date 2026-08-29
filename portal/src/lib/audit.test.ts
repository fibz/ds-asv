import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { recordAudit } from "@/lib/audit";
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
    // wipe any AuditEvent leftovers from a previous (crashed) run
    await adminQuery(`DELETE FROM "AuditEvent"`);
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

  afterAll(async () => {
    // deleting the org cascades to its AuditEvent rows (onDelete: Cascade)
    await adminQuery(`DELETE FROM "Organization" WHERE id = 'o1'`);
    await prisma.$disconnect();
  });
});
