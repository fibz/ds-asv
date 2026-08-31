import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, AuditEvent } from "@/lib/generated/prisma";

/**
 * Appends an AuditEvent row. This is the ONLY write path for audit events —
 * the design is append-only: no update/delete is ever exposed through the
 * helper (DB-level enforcement via triggers is a noted follow-up, out of
 * scope for this phase).
 *
 * RLS handling: AuditEvent is protected by the `audit_event_tenant_isolation`
 * policy (USING/WITH CHECK `"organizationId" = current_setting('app.tenant_id')`),
 * so the INSERT only succeeds when the session tenant context is bound to
 * `ctx.organizationId`.
 *
 * Two call shapes:
 *
 * 1. WITH `tx` (Phase 2 service layer: api-key create/update/revoke/rotate):
 *    the caller owns the transaction and has already bound the tenant context
 *    on it (`setRlsContext(ctx.organizationId, tx)`), so the audit write runs
 *    through the caller's `tx` and is atomic with the triggering operation.
 *
 * 2. WITHOUT `tx` (historical callers, e.g. audit.test.ts): keep the
 *    historical behavior — this helper owns its own transaction, binds the
 *    context on that transaction's connection, and runs the create through the
 *    same `tx` client. Callers only pass the TenantContext — they never touch
 *    RLS plumbing. (A bare `prisma.auditEvent.create` with no bound context is
 *    rejected by RLS: verified 42501 "new row violates row-level security".)
 */
export async function recordAudit(
  ctx: TenantContext,
  action: string,
  resourceType: string,
  resourceId?: string,
  before?: unknown,
  after?: unknown,
  reason?: string,
  tx?: Prisma.TransactionClient
) {
  if (tx) {
    return tx.auditEvent.create({
      data: {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action,
        resourceType,
        resourceId,
        before: before != null ? (before as any) : undefined,
        after: after != null ? (after as any) : undefined,
        reason,
      },
    });
  }
  return prisma.$transaction(async (innerTx) => {
    await setRlsContext(ctx.organizationId, innerTx);
    return innerTx.auditEvent.create({
      data: {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action,
        resourceType,
        resourceId,
        before: before != null ? (before as any) : undefined,
        after: after != null ? (after as any) : undefined,
        reason,
      },
    });
  });
}

export interface AuditFilter {
  resourceType?: string;
  action?: string;
  limit?: number;
  cursor?: string;
}

export async function listAuditEvents(
  ctx: TenantContext,
  filter: AuditFilter = {}
): Promise<{ events: AuditEvent[]; nextCursor: string | null }> {
  const limit = filter.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const events = await tx.auditEvent.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(filter.resourceType ? { resourceType: filter.resourceType } : {}),
        ...(filter.action ? { action: filter.action } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      // Prisma's cursor is INCLUSIVE of the cursor row: without `skip: 1` the
      // next page repeats the cursor row and pagination loops (verified against
      // Prisma 7.10 + the live test DB). `skip: 1` is the documented pattern
      // (prisma.io/docs/orm/prisma-client/queries/pagination). Deviation from
      // the brief's verbatim snippet, required by R4's non-vacuous pagination
      // assertion — ratified by controller ruling R14.
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = events.length > limit;
    const page = hasMore ? events.slice(0, limit) : events;
    return { events: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  });
}
