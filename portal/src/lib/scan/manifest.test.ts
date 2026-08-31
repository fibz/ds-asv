import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets } from "@/lib/scan/service";
import { issueScanManifest, verifyScanManifest, simulatedScanner } from "@/lib/scan/manifest";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_manifest_0001";
const USER = "user_manifest_0001";

// Mirrors manifest.ts: the HMAC secret fallback and canonical() sorted-key JSON
// serialization, used to build a VALIDLY SIGNED manifest with an expired timestamp.
const DEV_SECRET = process.env.MANIFEST_SECRET || "dev-manifest-secret";
function reSign(payload: Record<string, unknown>): string {
  return createHmac("sha256", DEV_SECRET)
    .update(JSON.stringify(payload, Object.keys(payload).sort()))
    .digest("hex");
}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}
const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "scan_operator", isStaff: false, appMode: "prod" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const t of ["Finding", "ScanTarget", "Scan", "AuditEvent", "Asset"]) {
      await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [ORG]);
    }
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("scan manifest", () => {
  let scanId = "";
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, (tx) => tx.organization.create({ data: { id: ORG, name: "Manifest Org" } }));
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-manifest", email: "m@x.com" } }));
    const assetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_manifest_1", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.1.1.1", lifecycleState: "active", verificationState: "verified" } }))).id;
    scanId = (await createScanFromAssets(ctx, { name: "manifest scan", assetIds: [assetId] })).id;
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("issues a signed expiring manifest with the target snapshot", async () => {
    const { manifest, expiresAt } = await issueScanManifest(ctx, scanId);
    expect(manifest).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const verified = await verifyScanManifest(manifest);
    expect(verified?.scanId).toBe(scanId);
    expect(verified?.organizationId).toBe(ORG);
    expect(verified?.targets.map((t) => t.canonicalIdentifier)).toEqual(["10.1.1.1"]);
  });

  it("rejects tampered and garbage manifests", async () => {
    const { manifest } = await issueScanManifest(ctx, scanId);
    const [payload, sig] = manifest.split(".");
    const tampered = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), targets: [] })).toString("base64url")}.${sig}`;
    expect(await verifyScanManifest(tampered)).toBeNull();
    expect(await verifyScanManifest("garbage")).toBeNull();
  });

  it("rejects an expired manifest that is still VALIDLY signed", async () => {
    const { manifest } = await issueScanManifest(ctx, scanId);
    const [payloadB64] = manifest.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as Record<string, unknown>;
    payload.expiresAt = new Date(Date.now() - 1000).toISOString();
    // Valid signature over the mutated payload (expiry moved to the past) so the
    // rejection must come from the expiry branch, not the signature check.
    const expiredValid = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${reSign(payload)}`;
    expect(await verifyScanManifest(expiredValid)).toBeNull();
  });

  it("simulatedScanner returns canned findings per target", async () => {
    const { manifest } = await issueScanManifest(ctx, scanId);
    const result = await simulatedScanner(manifest);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].findings.length).toBeGreaterThanOrEqual(1);
  });
});
