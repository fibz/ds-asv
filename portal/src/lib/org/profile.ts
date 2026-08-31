import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, Contact } from "@/lib/generated/prisma";

const CONTACT_TYPES = ["business", "security", "billing", "emergency"] as const;

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

export interface OrgProfile {
  id: string;
  name: string;
  parentOrgId: string | null;
  parentName: string | null;
  contacts: Contact[];
}

export interface ContactInput {
  id?: string;
  type: string;
  name: string;
  email: string;
  phone?: string | null;
  escalationOrder?: number;
}

export async function getOrgProfile(ctx: TenantContext): Promise<OrgProfile> {
  return withTenant(ctx.organizationId, async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: ctx.organizationId } });
    if (!org) throw new Error("Organization not found");
    const parent = org.parentOrgId ? await tx.organization.findUnique({ where: { id: org.parentOrgId } }) : null;
    const contacts = await tx.contact.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { escalationOrder: "asc" } });
    return {
      id: org.id,
      name: org.name,
      parentOrgId: org.parentOrgId,
      parentName: parent?.name ?? null,
      contacts,
    };
  });
}

export async function updateOrgProfile(
  ctx: TenantContext,
  input: { name?: string; contacts?: ContactInput[] }
): Promise<OrgProfile> {
  return withTenant(ctx.organizationId, async (tx) => {
    const before = await tx.organization.findUnique({ where: { id: ctx.organizationId } });
    if (!before) throw new Error("Organization not found");

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("name must be a non-empty string");
      if (name.length > 200) throw new Error("name too long");
      await tx.organization.update({ where: { id: ctx.organizationId }, data: { name } });
    }

    for (const c of input.contacts ?? []) {
      if (!CONTACT_TYPES.includes(c.type as (typeof CONTACT_TYPES)[number])) {
        throw new Error(`contact type must be one of ${CONTACT_TYPES.join(", ")}`);
      }
      if (!c.name?.trim() || !c.email?.trim()) throw new Error("contact name and email are required");
      if (c.id) {
        const existing = await tx.contact.findFirst({ where: { id: c.id, organizationId: ctx.organizationId } });
        if (existing) {
          await tx.contact.update({
            where: { id: c.id },
            data: { type: c.type, name: c.name.trim(), email: c.email.trim(), phone: c.phone ?? null, escalationOrder: c.escalationOrder ?? 1 },
          });
        }
      } else {
        await tx.contact.create({
          data: {
            organizationId: ctx.organizationId,
            type: c.type,
            name: c.name.trim(),
            email: c.email.trim(),
            phone: c.phone ?? null,
            escalationOrder: c.escalationOrder ?? 1,
          },
        });
      }
    }

    await recordAudit(ctx, "org.profile.updated", "Organization", ctx.organizationId, { name: before.name }, { name: input.name ?? before.name }, undefined, tx);

    const org = await tx.organization.findUnique({ where: { id: ctx.organizationId } });
    const parent = org!.parentOrgId ? await tx.organization.findUnique({ where: { id: org!.parentOrgId } }) : null;
    const contacts = await tx.contact.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { escalationOrder: "asc" } });
    return { id: org!.id, name: org!.name, parentOrgId: org!.parentOrgId, parentName: parent?.name ?? null, contacts };
  });
}
