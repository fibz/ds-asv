import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext, tenantContextFromRequest } from "@/lib/tenant";
import { verifyToken } from "@/lib/auth/keycloak";
import { createScanFromAssets, transitionScanStatus } from "@/lib/scan/service";
import { ingestFindings } from "@/lib/scan/findings";
import { buildReport, submitReport, isReportFinal } from "@/lib/scan/report";
import { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion } from "@/lib/scope/service";
import { POST as attestPOST } from "@/app/api/v1/reports/[reportId]/attest/route";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

// Phase 8a LIVE exit: real Keycloak login → real token → REAL jose
// verification against the running realm's JWKS (no mocks) → staff claim
// finalizes a prod report; a real non-staff token stays fail-closed (409).
// Skips cleanly when the local Keycloak (KEYCLOAK_ISSUER from .env) is
// unreachable, so the committed suite stays green on machines without the
// docker realm. Deliberately does NOT vi.mock("jose") or the prisma client.

const ISSUER = (process.env.KEYCLOAK_ISSUER || "").replace(/\/+$/, "");
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || "";
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || "";
const TOKEN_URL = `${ISSUER}/protocol/openid-connect/token`;

const ORG = "org_live_kc_8a_001";
const USER_STAFF = "user_live_kc_staff_001";
const USER_REG = "user_live_kc_reg_001";
const ASSET = "asset_live_kc_8a_1";

const staffCtx: TenantContext = { userId: USER_STAFF, organizationId: ORG, role: "organization_owner", isStaff: false, appMode: "prod" };

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

/** Mints a REAL access token from the running Keycloak via the password grant. */
async function mintToken(username: string, password: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      username,
      password,
    }),
  });
  if (!res.ok) throw new Error(`token grant failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function decodeSub(token: string): string {
  const part = token.split(".")[1];
  const json = Buffer.from(part, "base64url").toString("utf-8");
  return (JSON.parse(json) as { sub: string }).sub;
}

function bearerRequest(path: string, token: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "attested", reason: "phase 8a live exit" }),
  });
}

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const t of ["Session", "Dispute", "Authorization", "ReportAttestation", "Report", "ScopeItem", "ScopeVersion", "ScopeSet", "Finding", "ScanTarget", "Scan", "AuditEvent", "Asset", "OrganizationMembership"]) {
      await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [ORG]);
    }
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id IN ($1, $2)`, [USER_STAFF, USER_REG]);
  } finally { await admin.end(); }
}

/** Seeds the prod chain (org, memberships, verified asset, approved scope,
 * gated scan, findings, submitted reports) so the attest tests exercise the
 * requested transitions only. Keys the User rows to the REAL Keycloak subs. */
async function seedChain(staffSub: string, regSub: string): Promise<{ reportStaff: string; reportReg: string }> {
  await adminWipe();
  await withTenant(ORG, (tx) => tx.organization.create({ data: { id: ORG, name: `Live8a ${ORG}` } }));
  await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER_STAFF, idpId: staffSub, email: "staff@asv.test" } }));
  await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER_REG, idpId: regSub, email: "user@asv.test" } }));
  for (const u of [USER_STAFF, USER_REG]) {
    await withTenant(ORG, (tx) => tx.organizationMembership.create({ data: { userId: u, organizationId: ORG, role: "organization_owner" } }));
  }
  await withTenant(ORG, (tx) => tx.asset.create({
    data: { id: ASSET, organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.8.8.8", lifecycleState: "active", verificationState: "verified" },
  }));

  const set = await createScopeSet(staffCtx, { name: "PCI-8a" });
  const version = await createScopeVersion(staffCtx, set.id, { assetIds: [ASSET] });
  await submitScopeVersion(staffCtx, version.id);
  await approveScopeVersion(staffCtx, version.id);

  // APP_MODE=prod is already stubbed for the whole file (beforeAll) — the
  // gated scan, prod attestation and fail-closed staff gate all read it.
  const scanA = (await createScanFromAssets(staffCtx, { name: "live-a", assetIds: [ASSET] })).id;
  const scanB = (await createScanFromAssets(staffCtx, { name: "live-b", assetIds: [ASSET] })).id;
  for (const sid of [scanA, scanB]) {
    await transitionScanStatus(staffCtx, sid, "RUNNING");
    await transitionScanStatus(staffCtx, sid, "COMPLETED");
  }
  expect((await ingestFindings(staffCtx, scanA, [{ assetId: ASSET, qid: "q-live8a", severity: "4", title: "Weak TLS" }])).count).toBe(1);
  expect((await ingestFindings(staffCtx, scanB, [{ assetId: ASSET, qid: "q-live8a-b", severity: "3", title: "Weak Cipher" }])).count).toBe(1);
  const reportA = await buildReport(staffCtx, scanA);
  const reportB = await buildReport(staffCtx, scanB);
  expect(reportA.scopeVersionId).toBe(version.id);
  await submitReport(staffCtx, reportA.id);
  await submitReport(staffCtx, reportB.id);
  return { reportStaff: reportA.id, reportReg: reportB.id };
}

describe("phase 8a live Keycloak exit (real login → staff attest FINAL / non-staff 409)", () => {
  let live = false;
  let staffToken = "";
  let regToken = "";
  let staffSub = "";
  let regSub = "";
  let reportStaff = "";
  let reportReg = "";

  beforeAll(async () => {
    // Reachability probe (real HTTP to the configured issuer). When the local
    // Keycloak is not running this skips the whole suite cleanly.
    try {
      const res = await fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(3000) });
      live = res.ok && !!CLIENT_ID && !!CLIENT_SECRET;
    } catch {
      live = false;
    }
    if (!live) return;
    vi.stubEnv("APP_MODE", "prod");
    staffToken = await mintToken("staff-user", "staff123");
    regToken = await mintToken("regular-user", "user123");
    staffSub = decodeSub(staffToken);
    regSub = decodeSub(regToken);
    ({ reportStaff, reportReg } = await seedChain(staffSub, regSub));
  }, 30000);

  afterAll(async () => {
    if (live) await adminWipe();
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it("really verifies the real staff token against the running realm JWKS (signature, issuer, audience, RS256)", async (ctx) => {
    if (!live) return ctx.skip();
    const claims = await verifyToken(staffToken);
    expect(claims.iss).toBe(ISSUER);
    const roles = (claims.realm_access as { roles?: string[] })?.roles ?? [];
    expect(roles).toContain("asv-staff");
  });

  it("real staff login through the request path finalizes the prod report (attested + FINAL)", async (ctx) => {
    if (!live) return ctx.skip();
    const reqCtx = await tenantContextFromRequest(bearerRequest(`/api/v1/reports/${reportStaff}/attest`, staffToken));
    expect(reqCtx).not.toBeNull();
    expect(reqCtx?.isStaff).toBe(true);
    const res = await attestPOST(bearerRequest(`/api/v1/reports/${reportStaff}/attest`, staffToken), {
      params: Promise.resolve({ reportId: reportStaff }),
    });
    expect(res.status).toBe(200);
    const report = (await res.json()) as { status: string; scopeVersionId?: string | null; approvedScopeVersionId?: string | null };
    expect(report.status).toBe("attested");
    expect(isReportFinal(report)).toBe(true);
  });

  it("real non-staff login is fail-closed in prod (staff gate → 409)", async (ctx) => {
    if (!live) return ctx.skip();
    const reqCtx = await tenantContextFromRequest(bearerRequest(`/api/v1/reports/${reportReg}/attest`, regToken));
    expect(reqCtx).not.toBeNull();
    expect(reqCtx?.isStaff).toBe(false);
    const res = await attestPOST(bearerRequest(`/api/v1/reports/${reportReg}/attest`, regToken), {
      params: Promise.resolve({ reportId: reportReg }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "attestation requires a staff reviewer in prod" });
  });
});