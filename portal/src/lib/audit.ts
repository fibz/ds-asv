import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

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
