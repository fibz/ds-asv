import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, Session } from "@/lib/generated/prisma";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

/**
 * True when the generated Prisma client exposes the Session model. The
 * session registry is additive: callers (auth path, tests mocking an older
 * prisma surface) proceed without it instead of crashing.
 */
export function sessionModelAvailable(): boolean {
  return typeof (prisma as { session?: { findUnique?: unknown } }).session?.findUnique === "function";
}

/**
 * Records (or refreshes) an authenticated access. One JWT = one session row
 * per org, keyed by the sha256 of the raw token (composite unique on
 * organizationId + tokenHash — the same credential yields a separate session
 * in each org). A revoked row is never un-revoked.
 */
export async function recordSessionAccess(
  ctx: TenantContext,
  input: { tokenHash: string; userAgent?: string; ipHash?: string }
): Promise<void> {
  if (!sessionModelAvailable()) return;
  await withTenant(ctx.organizationId, (tx) =>
    tx.session.upsert({
      where: { organizationId_tokenHash: { organizationId: ctx.organizationId, tokenHash: input.tokenHash } },
      update: { lastSeenAt: new Date(), userAgent: input.userAgent ?? null, ipHash: input.ipHash ?? null },
      create: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        tokenHash: input.tokenHash,
        userAgent: input.userAgent,
        ipHash: input.ipHash,
      },
    })
  );
}

export async function listActiveSessions(ctx: TenantContext): Promise<Session[]> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.session.findMany({
      where: { organizationId: ctx.organizationId, revokedAt: null },
      orderBy: { lastSeenAt: "desc" },
    })
  );
}

export async function getSession(ctx: TenantContext, sessionId: string): Promise<Session | null> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.session.findUnique({ where: { id: sessionId } })
  );
}

export async function revokeSession(
  ctx: TenantContext,
  sessionId: string,
  reason?: string
): Promise<Session | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const session = await tx.session.findUnique({ where: { id: sessionId } });
    if (!session || session.revokedAt) return session ?? null;
    const updated = await tx.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedById: ctx.userId },
    });
    await recordAudit(ctx, "session.revoked", "Session", sessionId, { revokedAt: null }, { revokedAt: updated.revokedAt }, reason, tx);
    return updated;
  });
}

/** True when tokenHash maps to a revoked session row in the org (RLS-scoped). */
export async function isSessionBlocked(organizationId: string, tokenHash: string): Promise<boolean> {
  if (!sessionModelAvailable()) return false;
  return withTenant(organizationId, async (tx) => {
    const session = await tx.session.findFirst({ where: { tokenHash } });
    return session?.revokedAt != null;
  });
}

/** Derives session metadata from a request: sha256 of the Bearer token. */
export function sessionMetaFromRequest(request: {
  headers: { get(name: string): string | null };
}): { tokenHash: string; userAgent?: string; ipHash?: string } | null {
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) return null;
  const userAgent = request.headers.get("user-agent") ?? undefined;
  const forwarded = request.headers.get("x-forwarded-for") ?? undefined;
  const ip = forwarded?.split(",")[0]?.trim();
  return {
    tokenHash: hashToken(match[1]),
    userAgent,
    ipHash: ip ? hashIp(ip) : undefined,
  };
}
