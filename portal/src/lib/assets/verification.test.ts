import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createVerificationChallenge, verifyAssetToken } from "@/lib/assets/verification";
import { retireAsset } from "@/lib/assets/service";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_asset_ver_0001";
const USER = "user_asset_ver_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "asset_manager", isStaff: false, appMode: "dev" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    await admin.query(`DELETE FROM "AssetVerification" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "AssetImport" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("asset verification", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Asset Ver Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-asset-ver", email: "ver@x.com" } });
    });
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("issues a challenge (hash stored, token returned once) and verifies it", async () => {
    const a = await prisma.$transaction(async (tx) => {
      await setRlsContext(ORG, tx);
      return tx.asset.create({ data: { organizationId: ORG, type: "fqdn", canonicalIdentifier: "verify.example.com" } });
    });
    const challenge = await createVerificationChallenge(ctx, a.id, "dns_txt");
    expect(challenge.method).toBe("dns_txt");
    expect(challenge.recordName).toBe("_asv-verify.verify.example.com");
    expect(challenge.token).toMatch(/^[A-Za-z0-9_-]+$/);

    // stored hash, never raw token
    const stored = await prisma.$transaction(async (tx) => {
      await setRlsContext(ORG, tx);
      return tx.assetVerification.findUnique({ where: { id: challenge.verificationId } });
    });
    expect(stored?.challengeHash).not.toContain(challenge.token);

    const verified = await verifyAssetToken(ctx, a.id, challenge.token);
    expect(verified.verificationState).toBe("verified");
    expect(verified.lifecycleState).toBe("active");
  });

  it("rejects a wrong or expired token", async () => {
    const a = await prisma.$transaction(async (tx) => {
      await setRlsContext(ORG, tx);
      return tx.asset.create({ data: { organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.9.9.9" } });
    });
    const challenge = await createVerificationChallenge(ctx, a.id, "manual");
    await expect(verifyAssetToken(ctx, a.id, "wrong-token")).rejects.toThrow(/invalid|expired/i);
    // expiry: backdate the challenge via admin and confirm the guard
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await admin.connect();
    await admin.query(`UPDATE "AssetVerification" SET "expiresAt" = now() - interval '1 hour' WHERE id = $1`, [challenge.verificationId]);
    await admin.end();
    await expect(verifyAssetToken(ctx, a.id, challenge.token)).rejects.toThrow(/expired/i);
    // expired status must persist (marking runs in its own committed tx — a
    // throw inside the main interactive tx would roll the write back)
    const expired = await prisma.$transaction(async (tx) => {
      await setRlsContext(ORG, tx);
      return tx.assetVerification.findUnique({ where: { id: challenge.verificationId } });
    });
    expect(expired?.status).toBe("expired");
    // ...and the transition is audited (asset.verification-expired) in the same tx
    const adminAudit = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await adminAudit.connect();
    const audit = await adminAudit.query(
      `SELECT "action" FROM "AuditEvent" WHERE "resourceType" = 'AssetVerification' AND "resourceId" = $1`,
      [challenge.verificationId]
    );
    await adminAudit.end();
    expect(audit.rows.map((r: { action: string }) => r.action)).toContain("asset.verification-expired");
  });

  it("cannot verify a retired asset — a pre-retirement challenge stays pending", async () => {
    const a = await prisma.$transaction(async (tx) => {
      await setRlsContext(ORG, tx);
      return tx.asset.create({ data: { organizationId: ORG, type: "fqdn", canonicalIdentifier: "retire-guard.example.com" } });
    });
    // challenge issued while the asset is still active (24h TTL)
    const challenge = await createVerificationChallenge(ctx, a.id, "dns_txt");
    await retireAsset(ctx, a.id);

    await expect(verifyAssetToken(ctx, a.id, challenge.token)).rejects.toThrow(/retired/i);

    // retire invariant holds: the asset must NOT flip back to active, and the
    // verification must NOT be marked verified — no state mutation on reject
    const asset = await prisma.$transaction(async (tx) => {
      await setRlsContext(ORG, tx);
      return tx.asset.findUnique({ where: { id: a.id } });
    });
    expect(asset?.lifecycleState).toBe("retired");
    const verification = await prisma.$transaction(async (tx) => {
      await setRlsContext(ORG, tx);
      return tx.assetVerification.findUnique({ where: { id: challenge.verificationId } });
    });
    expect(verification?.status).toBe("pending");
  });
});
