import { prisma } from "@/lib/prisma-client";
import { provisionKeycloakUser } from "@/lib/auth/keycloak";
import {
  sessionMetaFromRequest,
  isSessionBlocked,
  recordSessionAccess,
} from "@/lib/org/sessions";
import type { Prisma, Organization } from "@/lib/generated/prisma";

export type Role =
  | "organization_owner"
  | "security_admin"
  | "asset_manager"
  | "scan_operator"
  | "report_viewer"
  | "billing_admin";

/**
 * The 6-role union. Single source of truth — INVITABLE_ROLES in
 * @/lib/invitations aliases this list.
 */
export const ROLES: readonly Role[] = [
  "organization_owner",
  "security_admin",
  "asset_manager",
  "scan_operator",
  "report_viewer",
  "billing_admin",
];

/** Type guard: true only for the 6 valid membership roles. */
export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    (ROLES as readonly string[]).includes(value)
  );
}

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

const DEFAULT_STAFF_ROLE = "asv-staff";

/** True when the verified realm roles include the configured staff role. */
export function resolvesAsStaff(roles: string[]): boolean {
  const wanted = (process.env.STAFF_ROLE || DEFAULT_STAFF_ROLE).toLowerCase();
  // Role names come lowercased from realmRoles() already; lowercasing here
  // keeps the compare case-insensitive for any other caller (idempotent).
  return roles.map((r) => r.toLowerCase()).includes(wanted);
}

/** dev/test-only staff override: comma-separated idpIds or emails. */
export function staffUserIdOverride(): string[] {
  const raw = process.env.STAFF_USER_IDS;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
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
  // Defense in depth: the DB column is a free-form String; a row with a role
  // outside the 6-role union (e.g. corrupted seed data) must not be silently
  // cast into a TenantContext with unknown permission implications.
  if (!isRole(membership.role)) {
    throw new Error(`Invalid membership role: ${membership.role}`);
  }
  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role,
    isStaff: false,
    appMode: getAppMode(),
  };
}

/**
 * Route-handler auth helper: verifies the Bearer token, provisions the user,
 * then resolves tenant context from the active membership. Returns null when
 * unauthenticated or the user has no active org — callers respond 401.
 */
export async function tenantContextFromRequest(request: {
  headers: { get(name: string): string | null };
}): Promise<TenantContext | null> {
  const keycloakUser = await provisionKeycloakUser(request);
  if (!keycloakUser) return null;
  const user = await prisma.user.findUnique({ where: { idpId: keycloakUser.idpId } });
  if (!user) return null;
  let ctx: TenantContext | null = null;
  try {
    ctx = await resolveTenantContext(user.id);
  } catch {
    return null;
  }
  // Staff identity: prod requires the verified realm role claim; dev/test
  // additionally honors the STAFF_USER_IDS override. Both gates (report
  // attestation, dispute moderation) read ctx.isStaff — this overlay is the
  // single place staff is granted.
  const staff =
    getAppMode() === "prod"
      ? resolvesAsStaff(keycloakUser.roles)
      : resolvesAsStaff(keycloakUser.roles) ||
        staffUserIdOverride().includes(keycloakUser.idpId.toLowerCase()) ||
        staffUserIdOverride().includes(keycloakUser.email.toLowerCase());
  if (staff) ctx = { ...ctx, isStaff: true };
  // Session registry (user center): a revoked token is rejected; a valid
  // token is recorded. Registry unavailability never breaks auth (availability
  // over registry) — but when reachable, a revoked row is authoritative.
  try {
    const meta = sessionMetaFromRequest(request);
    if (meta) {
      if (await isSessionBlocked(ctx.organizationId, meta.tokenHash)) return null;
      await recordSessionAccess(ctx, meta);
    }
  } catch (err) {
    console.error("session registry error (auth continues):", err);
  }
  return ctx;
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
