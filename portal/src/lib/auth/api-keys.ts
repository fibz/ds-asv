import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";

const KEY_PREFIX = "sk_live_";
const SALT_BYTES = 16;

/**
 * ApiKey RLS policies + grants are deliberately deferred to Phase 2 (its first
 * task). asv_app has NO grants on "ApiKey" (fail-closed by design), so any v1
 * api-keys route that reached the table would 500 with permission-denied.
 * Until Phase 2 revives the surface, every api-keys route short-circuits to
 * this explicit, self-documenting 501 instead of an opaque 500.
 */
export const API_KEYS_NOT_IMPLEMENTED =
  "Not Implemented — API key management requires Phase 2 (ApiKey RLS + grants)";

/**
 * Generates a new API key in the form `sk_live_<48 random chars>`.
 */
export function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(36).toString("base64url");
}

/**
 * Splits a stored `salt$hash` value back into its two parts, or null when the
 * value is not in that format (e.g. legacy unsalted hashes).
 */
export function splitKeyHash(stored: string): {
  salt: string;
  hash: string;
} | null {
  const idx = stored.indexOf("$");
  if (idx === -1) return null;
  return { salt: stored.slice(0, idx), hash: stored.slice(idx + 1) };
}

/**
 * Hashes an API key for storage. We use SHA-256 over `salt + rawKey` with a
 * per-key random salt so a leaked database row cannot be reversed to the raw
 * secret and identical raw keys never produce identical stored values.
 *
 * Stored format: `<base64url salt>$<sha256 hex>` — the salt travels with the
 * hash so verification can recompute it.
 *
 * - `hashApiKey(rawKey)` (no salt): generates a fresh random salt — used when
 *   storing a newly created/rotated key.
 * - `hashApiKey(rawKey, salt)`: recomputes the value for an existing salt —
 *   used when verifying a presented key against a stored row.
 */
export async function hashApiKey(
  rawKey: string,
  salt?: string
): Promise<string> {
  const s = salt ?? randomBytes(SALT_BYTES).toString("base64url");
  const hash = createHash("sha256").update(s + rawKey).digest("hex");
  return `${s}$${hash}`;
}

/**
 * Masks a stored `salt$hash` value for display. We show the key prefix plus
 * the last 4 chars of the digest so users can identify keys without exposing
 * anything sensitive. Falls back to the whole value's tail for legacy
 * unsalted hashes.
 */
export function maskApiKey(keyHash: string): string {
  const parts = splitKeyHash(keyHash);
  const digest = parts ? parts.hash : keyHash;
  return `${KEY_PREFIX}••••••••${digest.slice(-4)}`;
}

export interface ApiKeyServiceInput {
  name: string;
  scopes: string[];
  expiresAt?: Date | null;
}

/** Creates a key for the tenant; returns the raw key exactly once. */
export async function createApiKey(ctx: TenantContext, input: ApiKeyServiceInput) {
  const rawKey = generateApiKey();
  const keyHash = await hashApiKey(rawKey);
  const created = await prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const key = await tx.apiKey.create({
      data: {
        name: input.name,
        keyHash,
        scopes: input.scopes,
        orgId: ctx.organizationId,
        expiresAt: input.expiresAt ?? null,
      },
    });
    await recordAudit(
      ctx, "api-key.create", "ApiKey", key.id,
      undefined, { name: key.name, scopes: key.scopes }, undefined, tx
    );
    return key;
  });
  return { id: created.id, name: created.name, key: rawKey, scopes: created.scopes, expiresAt: created.expiresAt };
}

/** Lists the tenant's keys with masked hashes (never the salt or raw key). */
export async function listApiKeys(ctx: TenantContext) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const keys = await tx.apiKey.findMany({ orderBy: { createdAt: "desc" } });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      maskedKey: maskApiKey(k.keyHash),
      scopes: k.scopes,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    }));
  });
}

/** Updates mutable fields of one of the tenant's keys. */
export async function updateApiKey(
  ctx: TenantContext,
  id: string,
  patch: { name?: string; scopes?: string[]; expiresAt?: Date | null }
) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const before = await tx.apiKey.findUnique({ where: { id } });
    if (!before) throw new Error("API key not found");
    const updated = await tx.apiKey.update({
      where: { id },
      data: {
        name: patch.name ?? before.name,
        scopes: patch.scopes ?? before.scopes,
        expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : before.expiresAt,
      },
    });
    await recordAudit(ctx, "api-key.update", "ApiKey", id, { name: before.name }, { name: updated.name }, undefined, tx);
    return updated;
  });
}

/** Soft-revokes a key (sets revokedAt). Never a hard delete. */
export async function revokeApiKey(ctx: TenantContext, id: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const before = await tx.apiKey.findUnique({ where: { id } });
    if (!before) throw new Error("API key not found");
    const updated = await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await recordAudit(ctx, "api-key.revoke", "ApiKey", id, { revokedAt: null }, { revokedAt: updated.revokedAt }, undefined, tx);
    return updated;
  });
}

/** Revokes the old key and issues a fresh one with the same name + scopes. */
export async function rotateApiKey(ctx: TenantContext, id: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const before = await tx.apiKey.findUnique({ where: { id } });
    if (!before) throw new Error("API key not found");
    const rawKey = generateApiKey();
    const keyHash = await hashApiKey(rawKey);
    await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    const created = await tx.apiKey.create({
      data: { name: before.name, keyHash, scopes: before.scopes, orgId: ctx.organizationId },
    });
    await recordAudit(ctx, "api-key.rotate", "ApiKey", id, { revokedAt: null }, { revokedAt: new Date() }, "rotated", tx);
    return { id: created.id, name: created.name, key: rawKey, scopes: created.scopes, expiresAt: created.expiresAt };
  });
}
