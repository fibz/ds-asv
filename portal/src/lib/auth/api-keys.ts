import { createHash, randomBytes } from "crypto";

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
