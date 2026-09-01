import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { resolveTenantContext } from "@/lib/tenant";
import type { TenantContext } from "@/lib/tenant";
import {
  ScopeGuardError,
  approveScopeVersion,
  createScopeSet,
  createScopeVersion,
  submitScopeVersion,
} from "./service";
import { authorizationSignature, getAuthorization, issueAuthorization, statementHash, verifyAuthorizationSignature } from "./authorization";

const ORG = "org_scope_auth_0001";
const USER = "user_scope_auth_0001";
let ctx: TenantContext;

async function seedAndWipe() {
  const pg = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await pg.connect();
  try {
    await pg.query(`DELETE FROM "Authorization" WHERE "organizationId" = $1`, [ORG]);
    await pg.query(`DELETE FROM "ScopeItem" WHERE "organizationId" = $1`, [ORG]);
    await pg.query(`DELETE FROM "ScopeVersion" WHERE "organizationId" = $1`, [ORG]);
    await pg.query(`DELETE FROM "ScopeSet" WHERE "organizationId" = $1`, [ORG]);
    await pg.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [ORG]);
    await pg.query(`DELETE FROM "OrganizationMembership" WHERE "organizationId" = $1`, [ORG]);
    await pg.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
    await pg.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await pg.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
    // Direct SQL inserts bypass Prisma's @updatedAt client-management: the
    // NOT NULL created/updated columns have no DB defaults and must be set
    // explicitly (verified against the live DB via information_schema).
    await pg.query(`INSERT INTO "Organization" (id,name,"createdAt","updatedAt") VALUES ($1,$2,now(),now())`, [ORG, "Auth Org"]);
    await pg.query(`INSERT INTO "User" (id,"idpId",email,"createdAt","updatedAt") VALUES ($1,$2,$3,now(),now())`, [USER, "kc-scope-auth-1", "a@x.com"]);
    await pg.query(`INSERT INTO "OrganizationMembership" (id,"organizationId","userId",role,status,"updatedAt") VALUES ($1,$2,$3,$4,'active',now())`, ["om_scope_auth_1", ORG, USER, "organization_owner"]);
    await pg.query(`INSERT INTO "Asset" (id,"organizationId",type,"canonicalIdentifier","lifecycleState","verificationState","updatedAt") VALUES ($1,$2,$3,$4,'active','verified',now())`, ["asset_scope_auth_1", ORG, "ipv4", "10.2.2.2"]);
  } finally {
    await pg.end();
  }
}

beforeAll(async () => { await seedAndWipe(); ctx = await resolveTenantContext(USER); });
afterAll(async () => { await seedAndWipe(); await prisma.$disconnect(); });

describe("authorization service", () => {
  it("issues a signed authorization for an approved version", async () => {
    const set = await createScopeSet(ctx, { name: "Auth Scope" });
    const version = await createScopeVersion(ctx, set.id, { assetIds: ["asset_scope_auth_1"] });
    await expect(issueAuthorization(ctx, version.id)).rejects.toThrowError(ScopeGuardError);
    await submitScopeVersion(ctx, version.id);
    await approveScopeVersion(ctx, version.id);
    const auth = await issueAuthorization(ctx, version.id);
    expect(auth.statementHash).toBe(statementHash(""));
    expect(auth.scopeVersionHash).toBe(version.contentHash);
    expect(auth.signature).toBeTruthy();
    // idempotent
    const again = await issueAuthorization(ctx, version.id);
    expect(again.id).toBe(auth.id);
    // verify recomputes
    expect(verifyAuthorizationSignature(auth)).toBe(true);
    // tamper → reject: any field change must invalidate the signature
    expect(verifyAuthorizationSignature({ ...auth, scopeVersionHash: "x" })).toBe(false);
    const fetched = await getAuthorization(ctx, version.id);
    expect(fetched?.id).toBe(auth.id);
  });

  it("authorizationSignature is deterministic and tamper-sensitive", () => {
    const payload = { organizationId: ORG, scopeVersionId: "v1", statementHash: "s", scopeVersionHash: "h" };
    const a = authorizationSignature(payload);
    expect(authorizationSignature(payload)).toBe(a);
    expect(authorizationSignature({ ...payload, scopeVersionHash: "x" })).not.toBe(a);
  });
});