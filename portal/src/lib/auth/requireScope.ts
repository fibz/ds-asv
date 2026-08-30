import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma-client";
import { hashApiKey, splitKeyHash } from "@/lib/auth/api-keys";

export type Scope =
  | "read:scans"
  | "write:scans"
  | "read:waf"
  | "manage:waf"
  | "read:siem"
  | "write:siem"
  | "read:compliance"
  | "admin";

const ADMIN_SCOPE: Scope = "admin";

export function isScope(value: unknown): value is Scope {
  return (
    typeof value === "string" &&
    (["read:scans","write:scans","read:waf","manage:waf","read:siem","write:siem","read:compliance","admin"] as const).includes(value as Scope)
  );
}

/**
 * Resolves the API key from the X-API-Key header and checks its scope.
 *
 * RLS-aware: the candidate scan runs inside one transaction that first sets
 * the bootstrap flag app.api_key_lookup='1' (SELECT-only policy
 * api_key_lookup_bootstrap — the key lookup must work before a tenant context
 * exists), and the lastUsedAt write runs in the SAME transaction after
 * app.tenant_id is set from the matched key's orgId, so the isolation
 * policy's WITH CHECK passes.
 */
export async function requireScope(
  request: NextRequest,
  required: Scope
): Promise<
  | { ok: true; key: { id: string; orgId: string; scopes: Scope[] } }
  | { ok: false; response: Response }
> {
  const rawKey = request.headers.get("X-API-Key");
  if (!rawKey) {
    return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.api_key_lookup', '1', true)`);
    const candidates = await tx.apiKey.findMany({ where: { revokedAt: null } });
    let apiKey: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      const parts = splitKeyHash(candidate.keyHash);
      if (!parts) continue;
      const computed = await hashApiKey(rawKey, parts.salt);
      if (computed === candidate.keyHash) { apiKey = candidate; break; }
    }
    if (!apiKey) {
      return { ok: false as const, response: Response.json({ error: "Invalid API key" }, { status: 401 }) };
    }
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return { ok: false as const, response: Response.json({ error: "API key expired" }, { status: 401 }) };
    }
    const scopes = apiKey.scopes as Scope[];
    const hasAccess = scopes.includes(ADMIN_SCOPE) || scopes.includes(required);
    if (!hasAccess) {
      return { ok: false as const, response: Response.json({ error: "Insufficient scope", required }, { status: 403 }) };
    }
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, apiKey.orgId);
    await tx.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
    return { ok: true as const, key: { id: apiKey.id, orgId: apiKey.orgId, scopes } };
  });

  return result;
}
