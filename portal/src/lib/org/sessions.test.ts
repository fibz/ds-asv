import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import {
  hashToken, recordSessionAccess, listActiveSessions, getSession,
  revokeSession, isSessionBlocked, sessionMetaFromRequest,
} from "@/lib/org/sessions";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_session_svc_0001";
const ORG2 = "org_session_svc_0002";
const USER = "user_session_svc_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "organization_owner", isStaff: false, appMode: "prod" };
const ctx2: TenantContext = { userId: USER, organizationId: ORG2, role: "organization_owner", isStaff: false, appMode: "prod" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG, ORG2]) {
      await admin.query(`DELETE FROM "Session" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("session registry service", () => {
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG, ORG2]) {
      await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Svc ${o}` } }));
    }
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-svc", email: "svc@x.com" } }));
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("hashToken is deterministic sha256 hex", () => {
    expect(hashToken("tok-1")).toBe(hashToken("tok-1"));
    expect(hashToken("tok-1")).not.toBe(hashToken("tok-2"));
    expect(hashToken("tok-1")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records a session and refreshes lastSeenAt on reuse (no duplicate rows)", async () => {
    const h = hashToken("tok-a");
    await recordSessionAccess(ctx, { tokenHash: h, userAgent: "ua1" });
    const first = (await withTenant(ORG, (tx) => tx.session.findMany({ where: { tokenHash: h } })))[0];
    await new Promise((r) => setTimeout(r, 5));
    await recordSessionAccess(ctx, { tokenHash: h, userAgent: "ua1" });
    const rows = await withTenant(ORG, (tx) => tx.session.findMany({ where: { tokenHash: h } }));
    expect(rows).toHaveLength(1);
    // The sleep above backs a real assertion: reuse refreshes lastSeenAt.
    expect(rows[0].lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
    const all = await listActiveSessions(ctx);
    expect(all.map((s) => s.tokenHash)).toContain(h);
  });

  it("revokeSession sets revokedAt + revokedById and writes audit; blocked check flips", async () => {
    const h = hashToken("tok-b");
    await recordSessionAccess(ctx, { tokenHash: h });
    const session = (await listActiveSessions(ctx)).find((s) => s.tokenHash === h)!;
    expect(await isSessionBlocked(ORG, h)).toBe(false);

    const revoked = await revokeSession(ctx, session.id, "lost device");
    expect(revoked?.revokedAt).not.toBeNull();
    expect(revoked?.revokedById).toBe(USER);

    expect(await isSessionBlocked(ORG, h)).toBe(true);
    expect(await listActiveSessions(ctx)).not.toContainEqual(expect.objectContaining({ id: session.id }));

    const audits = await withTenant(ORG, (tx) =>
      tx.auditEvent.findMany({ where: { action: "session.revoked", resourceId: session.id } })
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("revoking an unknown/other-org session returns null (RLS-scoped)", async () => {
    expect(await revokeSession(ctx, "session_does_not_exist")).toBeNull();
    const h = hashToken("tok-c");
    await recordSessionAccess(ctx, { tokenHash: h });
    const session = (await listActiveSessions(ctx)).find((s) => s.tokenHash === h)!;
    expect(await revokeSession(ctx2, session.id)).toBeNull(); // other org, RLS hides it
    expect(await getSession(ctx, session.id)).not.toBeNull();
    expect(await getSession(ctx2, session.id)).toBeNull();
  });

  it("same tokenHash records one session per org; revoke is org-scoped", async () => {
    const h = hashToken("tok-org");
    await recordSessionAccess(ctx, { tokenHash: h, userAgent: "ua" });
    await recordSessionAccess(ctx2, { tokenHash: h, userAgent: "ua" });
    // Both orgs record the same credential without a global-unique clash.
    expect(await withTenant(ORG, (tx) => tx.session.findMany({ where: { tokenHash: h } }))).toHaveLength(1);
    expect(await withTenant(ORG2, (tx) => tx.session.findMany({ where: { tokenHash: h } }))).toHaveLength(1);
    expect(await isSessionBlocked(ORG, h)).toBe(false);
    expect(await isSessionBlocked(ORG2, h)).toBe(false);
    // Revoking in ORG blocks there but NOT in ORG2 (per-org scoping).
    const session = (await listActiveSessions(ctx)).find((s) => s.tokenHash === h)!;
    await revokeSession(ctx, session.id, "org-scoped test");
    expect(await isSessionBlocked(ORG, h)).toBe(true);
    expect(await isSessionBlocked(ORG2, h)).toBe(false);
  });

  it("recordSessionAccess never un-revokes a revoked session", async () => {
    const h = hashToken("tok-d");
    await recordSessionAccess(ctx, { tokenHash: h });
    const session = (await listActiveSessions(ctx)).find((s) => s.tokenHash === h)!;
    await revokeSession(ctx, session.id);
    await recordSessionAccess(ctx, { tokenHash: h }); // replayed token
    expect(await isSessionBlocked(ORG, h)).toBe(true);
  });

  it("sessionMetaFromRequest hashes the Bearer token", () => {
    const meta = sessionMetaFromRequest({ headers: { get: (n: string) => (n === "authorization" ? "Bearer abc.def" : n === "user-agent" ? "curl" : null) } });
    expect(meta?.tokenHash).toBe(hashToken("abc.def"));
    expect(meta?.userAgent).toBe("curl");
    const none = sessionMetaFromRequest({ headers: { get: () => null } });
    expect(none).toBeNull();
  });
});
