import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma-client";
import { hashApiKey } from "@/lib/auth/api-keys";

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

  const keyHash = await hashApiKey(rawKey);
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });

  if (!apiKey || apiKey.revokedAt) {
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