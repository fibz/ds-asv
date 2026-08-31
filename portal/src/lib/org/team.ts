import { prisma } from "@/lib/prisma-client";
import { setRlsContext, isRole, ROLES } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

export class TeamGuardError extends Error {}

export interface Member {
  id: string;
  userId: string;
  email: string;
  role: string;
  status: string;
  joinedAt: Date | null;
}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

async function countActiveOwners(tx: Prisma.TransactionClient, organizationId: string): Promise<number> {
  return tx.organizationMembership.count({
    where: { organizationId, role: "organization_owner", status: "active" },
  });
}

export async function listTeamMembers(ctx: TenantContext, status?: "active" | "invited"): Promise<Member[]> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.organizationMembership.findMany({
      where: { organizationId: ctx.organizationId, ...(status ? { status } : {}) },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }).then((rows) => rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      email: r.user.email,
      role: r.role,
      status: r.status,
      joinedAt: r.createdAt,
    })))
  );
}

export async function updateMemberRole(
  ctx: TenantContext,
  memberId: string,
  role: string
): Promise<Member | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const membership = await tx.organizationMembership.findUnique({ where: { id: memberId }, include: { user: true } });
    if (!membership || membership.organizationId !== ctx.organizationId) return null;
    if (!isRole(role)) throw new Error(`role must be one of: ${ROLES.join(", ")}`);
    if (membership.role === "organization_owner" && role !== "organization_owner") {
      const owners = await countActiveOwners(tx, ctx.organizationId);
      if (owners <= 1) throw new TeamGuardError("cannot demote the last organization owner");
    }
    const updated = await tx.organizationMembership.update({
      where: { id: memberId },
      data: { role },
      include: { user: true },
    });
    await recordAudit(ctx, "member.role.updated", "OrganizationMembership", memberId, { role: membership.role }, { role }, undefined, tx);
    return { id: updated.id, userId: updated.userId, email: updated.user.email, role: updated.role, status: updated.status, joinedAt: updated.createdAt };
  });
}

export async function removeMember(ctx: TenantContext, memberId: string): Promise<boolean> {
  return withTenant(ctx.organizationId, async (tx) => {
    const membership = await tx.organizationMembership.findUnique({ where: { id: memberId } });
    if (!membership || membership.organizationId !== ctx.organizationId) return false;
    if (membership.role === "organization_owner") {
      const owners = await countActiveOwners(tx, ctx.organizationId);
      if (owners <= 1) throw new TeamGuardError("cannot remove the last organization owner");
    }
    await tx.organizationMembership.delete({ where: { id: memberId } });
    await recordAudit(ctx, "member.removed", "OrganizationMembership", memberId, { userId: membership.userId }, undefined, undefined, tx);
    // Revoke every active session of the removed member (org-scoped).
    const sessions = await tx.session.findMany({ where: { organizationId: ctx.organizationId, userId: membership.userId, revokedAt: null } });
    for (const s of sessions) {
      await tx.session.update({ where: { id: s.id }, data: { revokedAt: new Date(), revokedById: ctx.userId } });
      await recordAudit(ctx, "session.revoked", "Session", s.id, { revokedAt: null }, { revokedAt: new Date() }, "member removed", tx);
    }
    return true;
  });
}
