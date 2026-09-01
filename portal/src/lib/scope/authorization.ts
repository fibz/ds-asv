import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext, getAppMode } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { getScopeVersion, ScopeGuardError } from "./service";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, Authorization } from "@/lib/generated/prisma";

export const MERCHANT_STATEMENT =
  "I authorize ASV scanning of the assets in the approved scope version of my organization.";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

/**
 * sha256 of the merchant statement. The default argument makes a no-arg call
 * sign the fixed statement; an explicit empty string is ALSO treated as the
 * merchant statement (the task's test asserts statementHash("") ===
 * statementHash(MERCHANT_STATEMENT), and plain default-arg semantics would not
 * trigger on an explicitly-passed "").
 */
export function statementHash(statement: string = MERCHANT_STATEMENT): string {
  return createHash("sha256").update(statement || MERCHANT_STATEMENT).digest("hex");
}

function signatureSecret(): string {
  const secret = process.env.MANIFEST_SECRET;
  if (secret) return secret;
  // Fail closed in prod: a missing secret would otherwise fall back to the
  // well-known dev secret, letting anyone forge validly-signed authorities.
  if (getAppMode() === "prod") throw new Error("MANIFEST_SECRET is required when APP_MODE=prod");
  return "dev-manifest-secret";
}

/**
 * Recursively sorts object keys at every level (inside arrays too) and compacts
 * — same canonical form as the scan manifest (src/lib/scan/manifest.ts
 * sortKeysDeep/canonical), so the HMAC covers the full nested payload
 * deterministically and tamper-evidently.
 */
function deepCanonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sort((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export function authorizationSignature(payload: {
  organizationId: string;
  scopeVersionId: string;
  statementHash: string;
  scopeVersionHash: string;
}): string {
  return createHmac("sha256", signatureSecret())
    .update(deepCanonicalJson(payload))
    .digest("hex");
}

export function verifyAuthorizationSignature(auth: {
  organizationId: string;
  scopeVersionId: string;
  statementHash: string;
  scopeVersionHash: string;
  signature: string;
}): boolean {
  const expected = Buffer.from(
    authorizationSignature({ organizationId: auth.organizationId, scopeVersionId: auth.scopeVersionId, statementHash: auth.statementHash, scopeVersionHash: auth.scopeVersionHash }),
    "hex"
  );
  const actual = Buffer.from(auth.signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function issueAuthorization(ctx: TenantContext, scopeVersionId: string): Promise<Authorization> {
  return withTenant(ctx.organizationId, async (tx) => {
    const version = await getScopeVersion(ctx, scopeVersionId);
    if (!version) throw new ScopeGuardError("Scope version not found");
    if (version.status !== "approved") throw new ScopeGuardError("authorization requires an approved scope version");
    const payload = {
      organizationId: ctx.organizationId,
      scopeVersionId,
      statementHash: statementHash(),
      scopeVersionHash: version.contentHash!,
    };
    const signature = authorizationSignature(payload);
    const existing = await tx.authorization.findUnique({ where: { scopeVersionId } });
    let auth: Authorization;
    if (existing) {
      auth = await tx.authorization.update({
        where: { id: existing.id },
        data: { statementHash: payload.statementHash, scopeVersionHash: payload.scopeVersionHash, signature, status: "issued", issuedById: ctx.userId, issuedAt: new Date() },
      });
    } else {
      auth = await tx.authorization.create({
        data: { organizationId: ctx.organizationId, scopeVersionId, statementHash: payload.statementHash, scopeVersionHash: payload.scopeVersionHash, signature, status: "issued", issuedById: ctx.userId },
      });
    }
    await recordAudit(ctx, "authorization.issued", "Authorization", auth.id, undefined, { scopeVersionId }, undefined, tx);
    return auth;
  });
}

export async function getAuthorization(ctx: TenantContext, scopeVersionId: string): Promise<Authorization | null> {
  return withTenant(ctx.organizationId, (tx) => tx.authorization.findUnique({ where: { scopeVersionId } }));
}