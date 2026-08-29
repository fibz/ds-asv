import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma-client";
import { requireScope } from "@/lib/auth/requireScope";
import { hashApiKey, splitKeyHash } from "@/lib/auth/api-keys";

// requireScope (and its ApiKey rows) run through the module-level prisma
// client. asv_app has NO grants on "ApiKey" until Tasks 6-7 land their RLS
// policies (deferred by design), so this test points prisma at the ADMIN
// connection — the permission surface is not what we are testing here; the
// salted-lookup logic is. The DB itself is the real test DB on :5433.
vi.mock("@/lib/prisma-client", async () => {
  const { PrismaClient } = await import("@/lib/generated/prisma");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const adapter = new PrismaPg({
    connectionString: process.env.ADMIN_DATABASE_URL!,
  });
  return { prisma: new PrismaClient({ adapter }) };
});

const ORG_ID = "org_reqscope_test_0001";

const RAW_ADMIN = "sk_live_reqscope_admin_1";
const RAW_SCAN = "sk_live_reqscope_scan_1";
const RAW_REVOKED = "sk_live_reqscope_revoked_1";
const RAW_EXPIRED = "sk_live_reqscope_expired_1";
const RAW_LEGACY = "sk_live_reqscope_legacy_1";

function reqWithKey(rawKey: string): NextRequest {
  return new NextRequest("http://localhost", {
    headers: { "X-API-Key": rawKey },
  });
}

describe("requireScope salted lookup", () => {
  beforeAll(async () => {
    // Wipe leftovers from a previous run, then seed one org with a full matrix
    // of ApiKey rows: salted active (admin + scoped), revoked, expired, a
    // legacy unsalted hash, and a malformed keyHash row.
    await prisma.apiKey.deleteMany({ where: { orgId: ORG_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.organization.create({
      data: { id: ORG_ID, name: "RequireScope Test Org" },
    });

    const legacyHash = createHash("sha256").update(RAW_LEGACY).digest("hex");
    await prisma.apiKey.createMany({
      data: [
        {
          id: "ak_reqscope_admin",
          name: "admin",
          keyHash: await hashApiKey(RAW_ADMIN),
          scopes: ["admin"],
          orgId: ORG_ID,
        },
        {
          id: "ak_reqscope_scan",
          name: "scoped",
          keyHash: await hashApiKey(RAW_SCAN),
          scopes: ["read:scans"],
          orgId: ORG_ID,
        },
        {
          id: "ak_reqscope_revoked",
          name: "revoked",
          keyHash: await hashApiKey(RAW_REVOKED),
          scopes: ["admin"],
          orgId: ORG_ID,
          revokedAt: new Date(),
        },
        {
          id: "ak_reqscope_expired",
          name: "expired",
          keyHash: await hashApiKey(RAW_EXPIRED),
          scopes: ["admin"],
          orgId: ORG_ID,
          expiresAt: new Date(Date.now() - 60_000),
        },
        {
          id: "ak_reqscope_legacy",
          name: "legacy-unsalted",
          keyHash: legacyHash,
          scopes: ["admin"],
          orgId: ORG_ID,
        },
        {
          id: "ak_reqscope_malformed",
          name: "malformed-keyhash",
          keyHash: "not-a-valid-format",
          scopes: ["admin"],
          orgId: ORG_ID,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { orgId: ORG_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.$disconnect();
  });

  it("accepts a salted key with admin scope", async () => {
    const result = await requireScope(reqWithKey(RAW_ADMIN), "admin");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.key.orgId).toBe(ORG_ID);
      expect(result.key.scopes).toContain("admin");
    }
  });

  it("accepts a salted key when the presented scope is in its scopes", async () => {
    const result = await requireScope(reqWithKey(RAW_SCAN), "read:scans");
    expect(result.ok).toBe(true);
  });

  it("rejects a key whose scopes lack the required scope", async () => {
    const result = await requireScope(reqWithKey(RAW_SCAN), "admin");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  it("rejects an unknown presented key", async () => {
    const result = await requireScope(
      reqWithKey("sk_live_never_issued_999"),
      "admin"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("rejects a revoked key", async () => {
    const result = await requireScope(reqWithKey(RAW_REVOKED), "admin");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("rejects an expired key", async () => {
    const result = await requireScope(reqWithKey(RAW_EXPIRED), "admin");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(result.response.body).toBeTruthy();
    }
  });

  it("fails closed for a legacy unsalted keyHash (no salt to verify against)", async () => {
    const result = await requireScope(reqWithKey(RAW_LEGACY), "admin");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("still accepts valid keys when malformed keyHash rows are present", async () => {
    const result = await requireScope(reqWithKey(RAW_ADMIN), "admin");
    expect(result.ok).toBe(true);
  });
});

describe("splitKeyHash parsing", () => {
  it("splits a well-formed salt$hash value", () => {
    expect(splitKeyHash("abc123$deadbeef")).toEqual({
      salt: "abc123",
      hash: "deadbeef",
    });
  });

  it("returns null for a value without a separator", () => {
    expect(splitKeyHash("deadbeef")).toBeNull();
  });

  it("splits at the FIRST separator, keeping the rest in the hash", () => {
    expect(splitKeyHash("salt$hash$more")).toEqual({
      salt: "salt",
      hash: "hash$more",
    });
  });

  it("tolerates an empty salt or empty hash", () => {
    expect(splitKeyHash("$hash")).toEqual({ salt: "", hash: "hash" });
    expect(splitKeyHash("salt$")).toEqual({ salt: "salt", hash: "" });
  });

  it("returns null for an empty value", () => {
    expect(splitKeyHash("")).toBeNull();
  });
});
