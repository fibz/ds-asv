import { prisma } from "@/lib/prisma-client";
import type { Prisma, Organization } from "@/lib/generated/prisma";

export type Role =
  | "organization_owner"
  | "security_admin"
  | "asset_manager"
  | "scan_operator"
  | "report_viewer"
  | "billing_admin";

export interface TenantContext {
  userId: string;
  organizationId: string;
  role: Role;
  isStaff: boolean;
  appMode: string;
}

export function getAppMode(): string {
  return process.env.APP_MODE || "dev";
}

/**
 * Resolves tenant context from the authenticated identity.
 * organizationId is derived from the user's membership, never from client input.
 *
 * Bootstrap note: this lookup runs BEFORE any tenant context exists, so it cannot
 * rely on `app.tenant_id`. Instead it scopes the read to the authenticated user
 * via `app.user_id` on the transaction connection, matching the
 * `membership_bootstrap` RLS policy (`"userId" = current_setting('app.user_id', true)`).
 * The user id itself comes from the verified identity provider subject, so it is
 * still never client-controlled.
 */
export async function resolveTenantContext(userId: string): Promise<TenantContext> {
  const membership = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', $1, true)`, userId);
    return tx.organizationMembership.findFirst({
      where: { userId, status: "active" },
      orderBy: { createdAt: "asc" },
    });
  });
  if (!membership) throw new Error("No active organization membership");
  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role as Role,
    isStaff: false,
    appMode: getAppMode(),
  };
}

/**
 * Sets the RLS session variable `app.tenant_id` for the current database
 * connection. The value is TRANSACTION-scoped (`set_config(..., true)`):
 *
 * - It is only visible to queries that run on the SAME connection inside the
 *   SAME transaction. Verified against the live DB: in autocommit the value
 *   reverts the moment the statement commits, and Prisma's pooled client does
 *   not guarantee connection reuse for later queries.
 * - Therefore callers MUST pass the interactive-transaction client (`tx`) and
 *   run all tenant queries through that same `tx`. Example:
 *
 *   ```ts
 *   await prisma.$transaction(async (tx) => {
 *     await setRlsContext(organizationId, tx);
 *     // all tenant-scoped queries via tx
 *   });
 *   ```
 *
 * The one-argument form is kept for interface compatibility; on its own it has
 * no lasting effect on subsequent queries and must not be relied on.
 */
export async function setRlsContext(
  organizationId: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx ?? prisma;
  await client.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, organizationId);
}

/**
 * Returns the parent org row of the org currently bound to the RLS session
 * variable (`app.tenant_id`), or null when the tenant has no parent.
 *
 * The Organization RLS policy intentionally grants only own-row + direct-child
 * reads (a same-table EXISTS subquery for the parent hits PostgreSQL's
 * infinite-recursion guard). This helper closes that gap via the SECURITY
 * DEFINER function `get_org_parent()` (migration 20260829142337_rls_hardening):
 * the function reads ONLY the session variable — it takes no parameters — so it
 * cannot be pointed at an arbitrary org and cannot become a cross-tenant read
 * channel. Like setRlsContext it must be called inside the same transaction
 * that set the context (pass `tx`), so the session variable is visible.
 */
export async function getParentOrg(
  tx?: Prisma.TransactionClient
): Promise<Organization | null> {
  const client = tx ?? prisma;
  const rows = await client.$queryRaw<Organization[]>`
    SELECT * FROM public.get_org_parent()
  `;
  return rows[0] ?? null;
}
