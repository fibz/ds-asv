import { prisma } from "@/lib/prisma-client";
import { setRlsContext, getAppMode } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, Dispute } from "@/lib/generated/prisma";

export class DisputeGuardError extends Error {}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

export async function raiseDispute(ctx: TenantContext, findingId: string, input: { justification: string }): Promise<Dispute> {
  const justification = input.justification.trim();
  if (!justification || justification.length > 2000) throw new DisputeGuardError("justification must be a non-empty string up to 2000 chars");
  return withTenant(ctx.organizationId, async (tx) => {
    const finding = await tx.finding.findUnique({ where: { id: findingId } });
    if (!finding) throw new Error("Finding not found");
    const dispute = await tx.dispute.create({
      data: { findingId, organizationId: ctx.organizationId, justification, raisedById: ctx.userId },
    });
    await recordAudit(ctx, "finding.dispute.raised", "Dispute", dispute.id, undefined, { findingId, justification }, undefined, tx);
    return dispute;
  });
}

export async function moderateDispute(
  ctx: TenantContext,
  disputeId: string,
  input: { status: "resolved" | "rejected"; note?: string }
): Promise<Dispute | null> {
  if (!["resolved", "rejected"].includes(input.status)) throw new DisputeGuardError("status must be resolved or rejected");
  return withTenant(ctx.organizationId, async (tx) => {
    const dispute = await tx.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) return null;
    if (getAppMode() === "prod" && !ctx.isStaff) throw new DisputeGuardError("dispute moderation requires a staff reviewer in prod");
    if (dispute.status !== "open") throw new DisputeGuardError("only open disputes can be moderated");
    const updated = await tx.dispute.update({
      where: { id: disputeId },
      data: { status: input.status, resolutionNote: input.note ?? null, moderatedById: ctx.userId, moderatedAt: new Date() },
    });
    await recordAudit(ctx, "finding.dispute.moderated", "Dispute", disputeId, { status: "open" }, { status: input.status, note: input.note ?? null }, undefined, tx);
    return updated;
  });
}

export async function listDisputes(ctx: TenantContext, filter: { findingId?: string } = {}): Promise<Dispute[]> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.dispute.findMany({
      where: { organizationId: ctx.organizationId, ...(filter.findingId ? { findingId: filter.findingId } : {}) },
      orderBy: { createdAt: "desc" },
    })
  );
}