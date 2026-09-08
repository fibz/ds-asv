import { prisma } from "@/lib/prisma-client";
import { setRlsContext, type TenantContext } from "@/lib/tenant";
import { attestReportOnTransaction, isReportFinal } from "@/lib/scan/report";
import { moderateDisputeOnTransaction } from "@/lib/disputes/service";
import type { Prisma, QsaAssignment } from "@/lib/generated/prisma";
import { QsaAssignmentGuardError, QsaAssignmentNotFoundError } from "./assignment";
import type { QsaAssignmentRow } from "./types";

export interface QsaReviewView {
  assignment: QsaAssignmentRow;
  customer: { id: string; name: string };
  report: { id: string; status: string; summary: unknown; createdAt: string; attestation: unknown };
  scan: { id: string; name: string; status: string; targets: unknown[] };
  scope: unknown | null;
  findings: unknown[];
  disputes: unknown[];
  isFinal: boolean;
}

function serializeAssignment(row: QsaAssignment): QsaAssignmentRow {
  return {
    id: row.id,
    qsaOrganizationId: row.qsaOrganizationId,
    customerOrganizationId: row.customerOrganizationId,
    reportId: row.reportId,
    assigneeUserId: row.assigneeUserId,
    createdByUserId: row.createdByUserId,
    status: row.status as QsaAssignmentRow["status"],
    dueAt: row.dueAt?.toISOString() ?? null,
    notes: row.notes,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function jsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  return value;
}

async function requireReviewAssignment(
  tx: Prisma.TransactionClient,
  ctx: TenantContext,
  assignmentId: string,
): Promise<QsaAssignment | null> {
  if (!ctx.isStaff) throw new QsaAssignmentGuardError("QSA review requires a staff reviewer");
  const membership = await tx.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: ctx.userId, organizationId: ctx.organizationId } },
  });
  if (!membership || membership.status !== "active") throw new QsaAssignmentGuardError("QSA review requires an active organization membership");
  const assignment = await tx.qsaAssignment.findFirst({ where: { id: assignmentId, qsaOrganizationId: ctx.organizationId } });
  if (!assignment || !["queued", "assigned", "in_review"].includes(assignment.status)) return null;
  if (assignment.assigneeUserId !== ctx.userId) return null;
  await tx.$executeRawUnsafe(`SELECT set_config('app.qsa_assignment_id', $1, true)`, assignment.id);
  return assignment;
}

async function loadReview(
  tx: Prisma.TransactionClient,
  assignment: QsaAssignment,
): Promise<QsaReviewView | null> {
  await setRlsContext(assignment.customerOrganizationId, tx);
  const [customer, report] = await Promise.all([
    tx.organization.findUnique({ where: { id: assignment.customerOrganizationId } }),
    tx.report.findUnique({ where: { id: assignment.reportId, organizationId: assignment.customerOrganizationId }, include: { attestation: true } }),
  ]);
  if (!customer || !report) return null;
  const scan = await tx.scan.findUnique({ where: { id: report.scanId, organizationId: assignment.customerOrganizationId }, include: { targets: true } });
  if (!scan) return null;
  const findings = await tx.finding.findMany({
    where: { scanId: scan.id, organizationId: assignment.customerOrganizationId },
    include: { disputes: true },
    orderBy: [{ severity: "desc" }, { qid: "asc" }],
  });
  const scope = report.scopeVersionId
    ? await tx.scopeVersion.findUnique({ where: { id: report.scopeVersionId }, include: { items: true } })
    : null;
  const disputes = findings.flatMap((finding) => finding.disputes);
  const approvedScopeVersionId = scope?.status === "approved" ? scope.id : null;
  return {
    assignment: serializeAssignment(assignment),
    customer: { id: customer.id, name: customer.name },
    report: {
      id: report.id,
      status: report.status,
      summary: jsonValue(report.summary),
      createdAt: report.createdAt.toISOString(),
      attestation: jsonValue(report.attestation),
    },
    scan: { id: scan.id, name: scan.name, status: scan.status, targets: jsonValue(scan.targets) as unknown[] },
    scope: jsonValue(scope),
    findings: jsonValue(findings.map((finding) => {
      const value = { ...finding } as Record<string, unknown>;
      delete value.disputes;
      return value;
    })) as unknown[],
    disputes: jsonValue(disputes) as unknown[],
    isFinal: isReportFinal({ status: report.status, scopeVersionId: report.scopeVersionId, approvedScopeVersionId }),
  };
}

async function withReviewId<T>(ctx: TenantContext, assignmentId: string, fn: (tx: Prisma.TransactionClient, assignment: QsaAssignment) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    await tx.$executeRawUnsafe(`SELECT set_config('app.qsa_org_id', $1, true)`, ctx.organizationId);
    await tx.$executeRawUnsafe(`SELECT set_config('app.qsa_user_id', $1, true)`, ctx.userId);
    const assignment = await requireReviewAssignment(tx, ctx, assignmentId);
    if (!assignment) throw new QsaAssignmentNotFoundError("QSA review assignment not found or not assigned to reviewer");
    return fn(tx, assignment);
  });
}

export function getQsaReview(ctx: TenantContext, assignmentId: string): Promise<QsaReviewView | null> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    await tx.$executeRawUnsafe(`SELECT set_config('app.qsa_org_id', $1, true)`, ctx.organizationId);
    await tx.$executeRawUnsafe(`SELECT set_config('app.qsa_user_id', $1, true)`, ctx.userId);
    const assignment = await requireReviewAssignment(tx, ctx, assignmentId);
    if (!assignment) return null;
    return loadReview(tx, assignment);
  });
}

export function attestAssignedReport(ctx: TenantContext, assignmentId: string, reason?: string): Promise<QsaReviewView | null> {
  return withReviewId(ctx, assignmentId, async (tx, assignment) => {
    await setRlsContext(assignment.customerOrganizationId, tx);
    const customerCtx = { ...ctx, organizationId: assignment.customerOrganizationId };
    await attestReportOnTransaction(customerCtx, tx, assignment.reportId, { reason });
    return loadReview(tx, assignment);
  });
}

export function moderateAssignedDispute(
  ctx: TenantContext,
  assignmentId: string,
  disputeId: string,
  input: { status: "resolved" | "rejected"; note?: string },
): Promise<QsaReviewView | null> {
  return withReviewId(ctx, assignmentId, async (tx, assignment) => {
    await setRlsContext(assignment.customerOrganizationId, tx);
    const customerCtx = { ...ctx, organizationId: assignment.customerOrganizationId };
    const dispute = await moderateDisputeOnTransaction(customerCtx, tx, disputeId, input);
    if (!dispute) return null;
    return loadReview(tx, assignment);
  });
}
