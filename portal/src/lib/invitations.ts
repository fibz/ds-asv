import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext, type Role } from "@/lib/tenant";
import type { OrganizationMembership } from "@/lib/generated/prisma";

/** Invitations expire 24 hours after creation. */
const INVITATION_TTL_MS = 24 * 3600 * 1000;

/**
 * The 6-role union (must stay in sync with `Role` in @/lib/tenant). Used by the
 * create route for its 400 validation and by createInvitation as defense in
 * depth — a role outside the union can never be stored.
 */
export const INVITABLE_ROLES: readonly Role[] = [
  "organization_owner",
  "security_admin",
  "asset_manager",
  "scan_operator",
  "report_viewer",
  "billing_admin",
];

/**
 * Only the SHA-256 digest of the raw token is ever stored, so a leaked DB row
 * cannot be redeemed and the raw token (returned once at create time) is the
 * bearer capability.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a single-use invitation that expires after 24h and returns the raw
 * token (shown to the inviter exactly once).
 *
 * RLS handling: this function wraps its own transaction and binds the tenant
 * context (`app.tenant_id`) to the target org on that transaction connection
 * BEFORE inserting. The org id is trusted to come from the caller's identity
 * (the route derives it via resolveTenantContext) — never from client input.
 * The Invitation INSERT would fail the RLS WITH CHECK policy if the context
 * were missing or pointed at another org.
 */
export async function createInvitation(
  organizationId: string,
  email: string,
  role: Role
): Promise<{ token: string }> {
  if (!INVITABLE_ROLES.includes(role)) {
    throw new Error("Invalid role");
  }
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  await prisma.$transaction(async (tx) => {
    await setRlsContext(organizationId, tx);
    await tx.invitation.create({
      data: {
        organizationId,
        email,
        role,
        tokenHash,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });
  });
  return { token };
}

/**
 * Redeems an invitation for the accepting user, creating their membership in
 * the inviter's organization. Throws for unknown, expired, or already-used
 * tokens (the accept route maps that to 400). Single-use: once acceptedAt is
 * set the token can never be redeemed again.
 *
 * RLS handling — the acceptor-without-membership case:
 *
 * 1. The acceptor has NO membership yet (that is the point of accepting), so
 *    `resolveTenantContext` would throw and no tenant context exists to read
 *    the invitation with. The only capability the acceptor possesses is the
 *    token itself, so this function first binds `app.invitation_token_hash`
 *    (from the presented token) on its transaction connection and looks the
 *    invitation up through the `invitation_bootstrap` FOR SELECT policy —
 *    the same shape as Task 3's `membership_bootstrap` policy. The read is
 *    scoped to the token hash, which is the SHA-256 of 32 random bytes
 *    (unguessable), so this is capability-based, not a cross-tenant channel.
 * 2. Once the invitation is found, the tenant context is bound to the
 *    INVITATION's organizationId (the inviter's org) and the membership
 *    INSERT + invitation UPDATE run under that context.
 *
 * All statements run on the one transaction connection, so the
 * transaction-scoped session variables are guaranteed visible (see
 * setRlsContext docs in @/lib/tenant).
 */
export async function acceptInvitation(
  token: string,
  userId: string
): Promise<OrganizationMembership> {
  const tokenHash = hashToken(token);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.invitation_token_hash', $1, true)`,
      tokenHash
    );
    const invitation = await tx.invitation.findUnique({ where: { tokenHash } });
    if (
      !invitation ||
      invitation.acceptedAt !== null ||
      invitation.expiresAt.getTime() < Date.now()
    ) {
      throw new Error("Invalid, expired, or already-used invitation");
    }

    await setRlsContext(invitation.organizationId, tx);
    const membership = await tx.organizationMembership.create({
      data: {
        userId,
        organizationId: invitation.organizationId,
        role: invitation.role,
      },
    });
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });
    return membership;
  });
}
