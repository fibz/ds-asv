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

/**
 * Resolves the API key from the `X-API-Key` header and checks that it has the
 * required scope. Admin scope satisfies all requirements.
 *
 * Returns either `{ key }` on success or a `NextResponse` error to return.
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
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // Stored hashes are salted (`salt$hash`), so the presented key cannot be
  // precomputed into an indexed lookup value. Fetch the small set of active
  // keys and verify the presented key against each row's salt.
  const candidates = await prisma.apiKey.findMany({
    where: { revokedAt: null },
  });
  let apiKey: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    const parts = splitKeyHash(candidate.keyHash);
    if (!parts) continue; // legacy unsalted hash — no salt to verify against
    const computed = await hashApiKey(rawKey, parts.salt);
    if (computed === candidate.keyHash) {
      apiKey = candidate;
      break;
    }
  }

  if (!apiKey) {
    return {
      ok: false,
      response: Response.json({ error: "Invalid API key" }, { status: 401 }),
    };
  }

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return {
      ok: false,
      response: Response.json({ error: "API key expired" }, { status: 401 }),
    };
  }

  const scopes = apiKey.scopes as Scope[];
  const hasAccess = scopes.includes(ADMIN_SCOPE) || scopes.includes(required);
  if (!hasAccess) {
    return {
      ok: false,
      response: Response.json(
        { error: "Insufficient scope", required },
        { status: 403 }
      ),
    };
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    ok: true,
    key: { id: apiKey.id, orgId: apiKey.orgId, scopes },
  };
}