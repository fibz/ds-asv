import { prisma } from "@/lib/prisma-client";
import { setRlsContext, type TenantContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { Prisma, QsaAssignment } from "@/lib/generated/prisma";
import type { QsaAssignmentRow, QsaAssignmentStatus, QsaCandidateReport } from "./types";

export class QsaAssignmentGuardError extends Error {}
export class QsaAssignmentConflictError extends Error {}
export class QsaAssignmentNotFoundError extends Error {}

type QsaTx = Prisma.TransactionClient;

function withQsaContext<T>(ctx: TenantContext, fn: (tx: QsaTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    await tx.$executeRawUnsafe(`SELECT set_config('app.qsa_org_id', $1, true)`, ctx.organizationId);
    await tx.$executeRawUnsafe(`SELECT set_config('app.qsa_user_id', $1, true)`, ctx.userId);
    return fn(tx);
  });
}

async function requireQsaMember(ctx: TenantContext, tx: QsaTx): Promise<void> {
  if (!ctx.isStaff) throw new QsaAssignmentGuardError("QSA access requires a staff reviewer");
  const membership = await tx.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: ctx.userId, organizationId: ctx.organizationId } },
  });
  if (!membership || membership.status !== "active") {
    throw new QsaAssignmentGuardError("QSA access requires an active organization membership");
  }
}

function serialize(row: QsaAssignment): QsaAssignmentRow {
  return {
    id: row.id,
    qsaOrganizationId: row.qsaOrganizationId,
    customerOrganizationId: row.customerOrganizationId,
    reportId: row.reportId,
    assigneeUserId: row.assigneeUserId,
    createdByUserId: row.createdByUserId,
    status: row.status as QsaAssignmentStatus,
    dueAt: row.dueAt?.toISOString() ?? null,
    notes: row.notes,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getAssignment(tx: QsaTx, ctx: TenantContext, assignmentId: string): Promise<QsaAssignment> {
  const assignment = await tx.qsaAssignment.findFirst({ where: { id: assignmentId, qsaOrganizationId: ctx.organizationId } });
  if (!assignment) throw new QsaAssignmentNotFoundError("QSA assignment not found");
  return assignment;
}

function validateNotes(notes: string | undefined): string | null {
  if (notes == null) return null;
  const value = notes.trim();
  if (value.length > 4000) throw new QsaAssignmentGuardError("notes must be 4000 characters or fewer");
  return value || null;
}

function validateDueAt(dueAt: Date | undefined): Date | null {
  if (dueAt == null) return null;
  if (!(dueAt instanceof Date) || Number.isNaN(dueAt.getTime())) throw new QsaAssignmentGuardError("dueAt must be a valid date");
  return dueAt;
}

async function requireAssigneeMember(tx: QsaTx, ctx: TenantContext, assigneeUserId: string): Promise<void> {
  const membership = await tx.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: assigneeUserId, organizationId: ctx.organizationId } },
  });
  if (!membership || membership.status !== "active") throw new QsaAssignmentGuardError("assignee must be an active QSA member");
}

export function listQsaCandidateReports(ctx: TenantContext): Promise<QsaCandidateReport[]> {
  return withQsaContext(ctx, async (tx) => {
    await requireQsaMember(ctx, tx);
    const rows = await tx.$queryRaw<QsaCandidateReport[]>`
      SELECT "reportId", "customerOrganizationId", "customerName", "reportStatus", "createdAt"
      FROM public.qsa_list_candidate_reports(${ctx.organizationId}, ${ctx.userId})
    `;
    return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }));
  });
}

export function listQsaAssignments(ctx: TenantContext, filter: { status?: QsaAssignmentStatus } = {}): Promise<QsaAssignmentRow[]> {
  return withQsaContext(ctx, async (tx) => {
    await requireQsaMember(ctx, tx);
    const rows = await tx.qsaAssignment.findMany({
      where: { qsaOrganizationId: ctx.organizationId, ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(serialize);
  });
}

export function createQsaAssignment(
  ctx: TenantContext,
  input: { reportId: string; assigneeUserId?: string; dueAt?: Date; notes?: string },
): Promise<QsaAssignmentRow> {
  return withQsaContext(ctx, async (tx) => {
    await requireQsaMember(ctx, tx);
    const reportId = input.reportId.trim();
    if (!reportId) throw new QsaAssignmentGuardError("reportId is required");
    const dueAt = validateDueAt(input.dueAt);
    const notes = validateNotes(input.notes);
    if (input.assigneeUserId) await requireAssigneeMember(tx, ctx, input.assigneeUserId);
    const candidates = await tx.$queryRaw<QsaCandidateReport[]>`
      SELECT "reportId", "customerOrganizationId", "customerName", "reportStatus", "createdAt"
      FROM public.qsa_list_candidate_reports(${ctx.organizationId}, ${ctx.userId})
      WHERE "reportId" = ${reportId}
    `;
    const candidate = candidates[0];
    if (!candidate) throw new QsaAssignmentNotFoundError("report is not eligible for QSA assignment");
    try {
      const assignment = await tx.qsaAssignment.create({
        data: {
          qsaOrganizationId: ctx.organizationId,
          customerOrganizationId: candidate.customerOrganizationId,
          reportId: candidate.reportId,
          assigneeUserId: input.assigneeUserId ?? null,
          status: input.assigneeUserId ? "assigned" : "queued",
          createdByUserId: ctx.userId,
          dueAt,
          notes,
          claimedAt: input.assigneeUserId ? new Date() : null,
        },
      });
      await recordAudit(ctx, "qsa.assignment.created", "QsaAssignment", assignment.id, undefined, {
        reportId: assignment.reportId,
        customerOrganizationId: assignment.customerOrganizationId,
        assigneeUserId: assignment.assigneeUserId,
        status: assignment.status,
      }, undefined, tx);
      return serialize(assignment);
    } catch (err) {
      if (err instanceof Error && (err.message.includes("QsaAssignment_active_report_key") || err.message.includes("Unique constraint"))) {
        throw new QsaAssignmentConflictError("report already has an active QSA assignment");
      }
      throw err;
    }
  });
}

export function claimQsaAssignment(ctx: TenantContext, assignmentId: string): Promise<QsaAssignmentRow> {
  return withQsaContext(ctx, async (tx) => {
    await requireQsaMember(ctx, tx);
    const result = await tx.qsaAssignment.updateMany({
      where: { id: assignmentId, qsaOrganizationId: ctx.organizationId, status: "queued", assigneeUserId: null },
      data: { status: "assigned", assigneeUserId: ctx.userId, claimedAt: new Date() },
    });
    if (result.count !== 1) throw new QsaAssignmentConflictError("assignment is no longer available in the shared queue");
    const assignment = await getAssignment(tx, ctx, assignmentId);
    await recordAudit(ctx, "qsa.assignment.claimed", "QsaAssignment", assignment.id, { status: "queued" }, { status: "assigned", assigneeUserId: ctx.userId }, undefined, tx);
    return serialize(assignment);
  });
}

export function startQsaReview(ctx: TenantContext, assignmentId: string): Promise<QsaAssignmentRow> {
  return withQsaContext(ctx, async (tx) => {
    await requireQsaMember(ctx, tx);
    const result = await tx.qsaAssignment.updateMany({
      where: { id: assignmentId, qsaOrganizationId: ctx.organizationId, status: "assigned", assigneeUserId: ctx.userId },
      data: { status: "in_review" },
    });
    if (result.count !== 1) throw new QsaAssignmentConflictError("assignment must be assigned to you before review starts");
    const assignment = await getAssignment(tx, ctx, assignmentId);
    await recordAudit(ctx, "qsa.assignment.review_started", "QsaAssignment", assignment.id, { status: "assigned" }, { status: "in_review" }, undefined, tx);
    return serialize(assignment);
  });
}

export function reassignQsaAssignment(ctx: TenantContext, assignmentId: string, assigneeUserId: string | null): Promise<QsaAssignmentRow> {
  return withQsaContext(ctx, async (tx) => {
    await requireQsaMember(ctx, tx);
    if (assigneeUserId) await requireAssigneeMember(tx, ctx, assigneeUserId);
    const current = await getAssignment(tx, ctx, assignmentId);
    if (!(["queued", "assigned", "in_review"] as string[]).includes(current.status)) throw new QsaAssignmentConflictError("only active assignments can be reassigned");
    const nextStatus = assigneeUserId ? "assigned" : "queued";
    const updated = await tx.qsaAssignment.update({
      where: { id: assignmentId },
      data: { assigneeUserId, status: nextStatus, claimedAt: assigneeUserId ? (current.claimedAt ?? new Date()) : null },
    });
    await recordAudit(ctx, "qsa.assignment.reassigned", "QsaAssignment", assignmentId, { status: current.status, assigneeUserId: current.assigneeUserId }, { status: nextStatus, assigneeUserId }, undefined, tx);
    return serialize(updated);
  });
}

export function completeQsaAssignment(ctx: TenantContext, assignmentId: string): Promise<QsaAssignmentRow> {
  return withQsaContext(ctx, async (tx) => {
    await requireQsaMember(ctx, tx);
    const result = await tx.qsaAssignment.updateMany({
      where: { id: assignmentId, qsaOrganizationId: ctx.organizationId, status: { in: ["assigned", "in_review"] }, assigneeUserId: ctx.userId },
      data: { status: "completed", completedAt: new Date() },
    });
    if (result.count !== 1) throw new QsaAssignmentConflictError("only your active review can be completed");
    const assignment = await getAssignment(tx, ctx, assignmentId);
    await recordAudit(ctx, "qsa.assignment.completed", "QsaAssignment", assignment.id, { status: "in_review" }, { status: "completed" }, undefined, tx);
    return serialize(assignment);
  });
}

export function cancelQsaAssignment(ctx: TenantContext, assignmentId: string, reason: string): Promise<QsaAssignmentRow> {
  return withQsaContext(ctx, async (tx) => {
    await requireQsaMember(ctx, tx);
    const value = reason.trim();
    if (!value || value.length > 2000) throw new QsaAssignmentGuardError("cancellation reason must be 1-2000 characters");
    const current = await getAssignment(tx, ctx, assignmentId);
    if (!(current.status === "queued" || current.status === "assigned" || current.status === "in_review")) throw new QsaAssignmentConflictError("only active assignments can be cancelled");
    const updated = await tx.qsaAssignment.update({ where: { id: assignmentId }, data: { status: "cancelled", cancelledAt: new Date() } });
    await recordAudit(ctx, "qsa.assignment.cancelled", "QsaAssignment", assignmentId, { status: current.status }, { status: "cancelled" }, value, tx);
    return serialize(updated);
  });
}
