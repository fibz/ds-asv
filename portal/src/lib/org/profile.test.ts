import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { getOrgProfile, updateOrgProfile } from "@/lib/org/profile";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_profile_0001";
const ORG2 = "org_profile_0002";
const USER = "user_profile_0001";

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
      await admin.query(`DELETE FROM "Contact" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("org profile service", () => {
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG, ORG2]) {
      await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Prof ${o}` } }));
    }
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-prof", email: "p@x.com" } }));
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("reads the org profile with contacts", async () => {
    await updateOrgProfile(ctx, { contacts: [{ type: "security", name: "Alice", email: "a@sec.com", escalationOrder: 1 }] });
    const profile = await getOrgProfile(ctx);
    expect(profile.id).toBe(ORG);
    expect(profile.contacts.some((c) => c.email === "a@sec.com")).toBe(true);
  });

  it("updates name and upserts contacts; empty name rejected", async () => {
    const updated = await updateOrgProfile(ctx, { name: "Renamed Org" });
    expect(updated.name).toBe("Renamed Org");
    await expect(updateOrgProfile(ctx, { name: "   " })).rejects.toThrow(/name/);
  });

  it("updates an existing contact by id instead of duplicating", async () => {
    const before = await getOrgProfile(ctx);
    const contact = before.contacts.find((c) => c.email === "a@sec.com")!;
    await updateOrgProfile(ctx, { contacts: [{ id: contact.id, type: "security", name: "Alice B", email: "a@sec.com" }] });
    const after = await getOrgProfile(ctx);
    const updated = after.contacts.find((c) => c.id === contact.id)!;
    expect(updated.name).toBe("Alice B");
    expect(after.contacts.filter((c) => c.email === "a@sec.com")).toHaveLength(1);
  });

  it("is tenant-scoped: other org sees its own profile, not ours", async () => {
    const theirs = await getOrgProfile(ctx2);
    expect(theirs.id).toBe(ORG2);
    expect(theirs.contacts.some((c) => c.email === "a@sec.com")).toBe(false);
  });

  it("records an audit event on update", async () => {
    await updateOrgProfile(ctx, { name: "Audited Org" });
    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { action: "org.profile.updated" } }));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
