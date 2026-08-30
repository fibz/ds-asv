import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";

const CHALLENGE_TTL_MS = 24 * 3600 * 1000; // challenge expires in 24h
const VERIFIED_TTL_MS = 90 * 24 * 3600 * 1000; // verification is good for 90 days

/** Issues a verification challenge. For dns_txt on an fqdn asset, the returned
 * recordName is the TXT record the customer publishes; the token is its value.
 * For manual, the customer pastes the token into the portal. Only the SHA-256
 * hash is stored. */
export async function createVerificationChallenge(
  ctx: TenantContext,
  assetId: string,
  method: "dns_txt" | "manual"
) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const asset = await tx.asset.findFirst({ where: { id: assetId, organizationId: ctx.organizationId } });
    if (!asset) throw new Error("Asset not found");
    if (asset.lifecycleState === "retired") throw new Error("Retired assets cannot be verified");
    if (method === "dns_txt" && asset.type !== "fqdn") throw new Error("dns_txt challenges require an fqdn asset");

    const token = randomBytes(24).toString("base64url");
    const challengeHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    const verification = await tx.assetVerification.create({
      data: { organizationId: ctx.organizationId, assetId, method, status: "pending", challengeHash, expiresAt },
    });
    await tx.asset.update({ where: { id: assetId }, data: { verificationState: "pending" } });
    await recordAudit(ctx, "asset.verification-challenge", "AssetVerification", verification.id, undefined, { method }, undefined, tx);
    return {
      verificationId: verification.id,
      method,
      token,
      recordName: method === "dns_txt" ? `_asv-verify.${asset.canonicalIdentifier}` : null,
      expiresAt,
    };
  });
}

/** Verifies a pending challenge by hashing the presented token. On success the
 * asset transitions to verificationState=verified, lifecycleState=active. */
export async function verifyAssetToken(ctx: TenantContext, assetId: string, token: string) {
  if (!token) throw new Error("Verification token is required");
  const presented = createHash("sha256").update(token).digest("hex");
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const pending = await tx.assetVerification.findFirst({
      where: { assetId, organizationId: ctx.organizationId, status: "pending" },
      orderBy: { createdAt: "desc" },
    });
    if (!pending || !pending.challengeHash) throw new Error("No pending verification challenge");
    // Retire invariant: a challenge issued before retirement (24h TTL) must not
    // re-activate a retired asset. Resolve the asset and check BEFORE any state
    // mutation — the verify path previously flipped retired assets back to
    // active while createVerificationChallenge already guarded the inverse.
    const asset = await tx.asset.findFirst({ where: { id: assetId, organizationId: ctx.organizationId } });
    if (!asset) throw new Error("Asset not found");
    if (asset.lifecycleState === "retired") throw new Error("Retired assets cannot be verified");
    if (pending.expiresAt && pending.expiresAt < new Date()) {
      // Mark expired in its own committed transaction — a throw inside the main
      // interactive tx would roll back the status write (Prisma rollbackOnError).
      await prisma.$transaction(async (tx) => {
        await setRlsContext(ctx.organizationId, tx);
        await tx.assetVerification.update({ where: { id: pending.id }, data: { status: "expired" } });
        await recordAudit(ctx, "asset.verification-expired", "AssetVerification", pending.id, { status: "pending" }, { status: "expired" }, undefined, tx);
      });
      throw new Error("Verification challenge expired");
    }
    if (pending.challengeHash !== presented) throw new Error("Invalid verification token");

    const expiresAt = new Date(Date.now() + VERIFIED_TTL_MS);
    await tx.assetVerification.update({
      where: { id: pending.id },
      data: { status: "verified", verifiedBy: ctx.userId, expiresAt },
    });
    const updated = await tx.asset.update({
      where: { id: assetId },
      data: { verificationState: "verified", lifecycleState: "active", lastSeenAt: new Date() },
    });
    await recordAudit(ctx, "asset.verify", "AssetVerification", pending.id, { status: "pending" }, { status: "verified" }, undefined, tx);
    return { verificationState: updated.verificationState, lifecycleState: updated.lifecycleState };
  });
}
