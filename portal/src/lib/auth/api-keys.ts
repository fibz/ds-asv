import { createHash, randomBytes } from "crypto";

const KEY_PREFIX = "sk_live_";

/**
 * Generates a new API key in the form `sk_live_<48 random chars>`.
 */
export function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(36).toString("base64url");
}

/**
 * Hashes an API key for storage. We use SHA-256 + per-key salt so a leaked
 * database row cannot be reversed to the raw secret.
 */
export async function hashApiKey(rawKey: string): Promise<string> {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Masks a key hash for display. We show a short fixed prefix + last 4 chars
 * of the hash so users can identify keys without exposing anything sensitive.
 */
export function maskApiKey(keyHash: string): string {
  const last4 = keyHash.slice(-4);
  return `${KEY_PREFIX}••••••••${last4}`;
}