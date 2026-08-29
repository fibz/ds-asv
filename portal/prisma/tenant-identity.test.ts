import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma-client";

describe("tenant identity models", () => {
  beforeAll(async () => {
    // clean slate (child rows first to respect FK constraints)
    await prisma.auditEvent.deleteMany();
    await prisma.organizationMembership.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates an organization with a parent (QSA nesting)", async () => {
    const qsa = await prisma.organization.create({ data: { name: "QSA" } });
    const merchant = await prisma.organization.create({
      data: { name: "Merchant", parentOrgId: qsa.id },
    });
    expect(merchant.parentOrgId).toBe(qsa.id);
  });

  it("creates a membership with a role", async () => {
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({ data: { idpId: "kc-user-1", email: "a@b.com" } });
    const m = await prisma.organizationMembership.create({
      data: { userId: user.id, organizationId: org.id, role: "organization_owner" },
    });
    expect(m.role).toBe("organization_owner");
  });
});

afterAll(async () => { await prisma.$disconnect(); });
