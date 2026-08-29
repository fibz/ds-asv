import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext, ROLES, type Role } from "@/lib/tenant";
import type { OrganizationMembership } from "@/lib/generated/prisma";

/** Invitations expire 24 hours after creation. */
const INVITATION_TTL_MS = 24 * 3600 * 1000;

/**
 * The 6-role union, aliased from @/lib/tenant's ROLES (single source of
 * truth). Used by the create route for its 400 validation and by
 * createInvitation as defense in depth — a role outside the union can never
 * be stored.
 */
export const INVITABLE_ROLES: readonly Role[] = ROLES;

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
 * the inviter's organization. Throws for unknown, expired, already-used, or
 * email-mismatched tokens (the accept route maps that to 400).
 *
 * Email binding: `email` is the authenticated identity's email (from the
 * verified IdP claims, passed by the accept route) and is compared to the
 * invitation's intended recipient — a forwarded token intended for
 * alice@corp.com cannot be redeemed by anyone else.
 *
 * Single-use is enforced by an ATOMIC claim gate (not by a check-then-update):
 * a conditional `updateMany where { id, acceptedAt: null }` sets acceptedAt
 * and returns the affected row count. At READ COMMITTED, concurrent redeemers
 * serialize on the row lock and the WHERE clause is re-evaluated after the
 * winner commits, so exactly one transaction ever observes count = 1 — the
 * membership @@unique([userId, organizationId]) alone would NOT catch two
 * DIFFERENT users redeeming the same token. A failed membership INSERT rolls
 * the whole transaction (including the claim) back.
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
 *    INVITATION's organizationId (the inviter's org) BEFORE the claim gate,
 *    so the UPDATE satisfies the invitation_tenant_isolation policy; the
 *    membership INSERT then runs under that same context.
 *
 * All statements run on the one transaction connection, so the
 * transaction-scoped session variables are guaranteed visible (see
 * setRlsContext docs in @/lib/tenant).
 */
export async function acceptInvitation(
  token: string,
  userId: string,
  email: string
): Promise<OrganizationMembership> {
  const tokenHash = hashToken(token);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.invitation_token_hash', $1, true)`,
      tokenHash
    );
    const invitation = await tx.invitation.findUnique({ where: { tokenHash } });
    if (!invitation) {
      throw new Error("Invalid, expired, or already-used invitation");
    }
    if (invitation.email.toLowerCase() !== email.toLowerCase()) {
      throw new Error("Invitation email does not match the accepting identity");
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new Error("Invalid, expired, or already-used invitation");
    }

    await setRlsContext(invitation.organizationId, tx);

    // Atomic single-use gate: only an unconsumed invitation can be claimed.
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new Error("Invalid, expired, or already-used invitation");
    }

    const membership = await tx.organizationMembership.create({
      data: {
        userId,
        organizationId: invitation.organizationId,
        role: invitation.role,
      },
    });
    return membership;
  });
}
