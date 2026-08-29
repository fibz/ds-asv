import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";
import type { TenantContext } from "@/lib/tenant";

/**
 * Appends an AuditEvent row. This is the ONLY write path for audit events —
 * the design is append-only: no update/delete is ever exposed through the
 * helper (DB-level enforcement via triggers is a noted follow-up, out of
 * scope for this phase).
 *
 * RLS handling: AuditEvent is protected by the `audit_event_tenant_isolation`
 * policy (USING/WITH CHECK `"organizationId" = current_setting('app.tenant_id')`),
 * so the INSERT only succeeds when the session tenant context is bound to
 * `ctx.organizationId`. `set_config(..., true)` is TRANSACTION-scoped, so this
 * helper owns its own transaction (the same shape as resolveTenantContext and
 * createInvitation): it opens `prisma.$transaction`, binds the context on that
 * transaction's connection, and runs the create through the same `tx` client.
 * Callers only pass the TenantContext — they never touch RLS plumbing.
 *
 * Note: the transaction-scoped context is deliberately NOT made available to
 * the caller's own transaction (no `tx` parameter). Keeping the audit write in
 * its own transaction avoids the footgun of rebinding `app.tenant_id` inside a
 * caller transaction that already bound a different tenant; audit rows are
 * side-effect logs and do not need to be atomic with the triggering operation.
 */
export async function recordAudit(
  ctx: TenantContext,
  action: string,
  resourceType: string,
  resourceId?: string,
  before?: Prisma.InputJsonValue,
  after?: Prisma.InputJsonValue,
  reason?: string
) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    return tx.auditEvent.create({
      data: {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action,
        resourceType,
        resourceId,
        before: before != null ? before : undefined,
        after: after != null ? after : undefined,
        reason,
      },
    });
  });
}
