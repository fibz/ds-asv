import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { Client } from "pg";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext, tenantContextFromRequest } from "@/lib/tenant";
import { createScanFromAssets, getScan, transitionScanStatus } from "@/lib/scan/service";
import { issueScanManifest, verifyScanManifest } from "@/lib/scan/manifest";
import { ingestFindings, runScanWithSimulatedScanner } from "@/lib/scan/findings";
import { buildReport, submitReport, attestReport, isReportFinal } from "@/lib/scan/report";
import { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion } from "@/lib/scope/service";
import { raiseDispute, moderateDispute } from "@/lib/disputes/service";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

// Mock jose so the Phase 6 request-path tests drive verifyToken with fixed
// claims instead of touching a real Keycloak issuer. The Phase 3 describe
// below never calls verifyToken (it uses ctx literals), so it is unaffected.
vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })),
}));

const ORG_A = "org_scan_exit_a_001";
const ORG_B = "org_scan_exit_b_001";
const USER_A = "user_scan_exit_a_001";
const USER_B = "user_scan_exit_b_001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}
const ctxA: TenantContext = { userId: USER_A, organizationId: ORG_A, role: "scan_operator", isStaff: false, appMode: "prod" };
const staffA: TenantContext = { ...ctxA, isStaff: true };
const ctxB: TenantContext = { userId: USER_B, organizationId: ORG_B, role: "scan_operator", isStaff: false, appMode: "prod" };

let assetA = "";

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG_A, ORG_B]) {
      for (const t of ["ReportAttestation", "Report", "Finding", "ScanTarget", "Scan", "AuditEvent", "Asset"]) {
        await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [o]);
      }
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id IN ($1, $2)`, [USER_A, USER_B]);
  } finally { await admin.end(); }
}

describe("phase 3 exit criteria", () => {
  let scanId = "";
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG_A, ORG_B]) await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Exit ${o}` } }));
    await withTenant(ORG_A, (tx) => tx.user.create({ data: { id: USER_A, idpId: "kc-scan-exit-a", email: "a@x.com" } }));
    await withTenant(ORG_B, (tx) => tx.user.create({ data: { id: USER_B, idpId: "kc-scan-exit-b", email: "b@x.com" } }));
    assetA = (await withTenant(ORG_A, (tx) => tx.asset.create({ data: { id: "asset_exit_a_1", organizationId: ORG_A, type: "ipv4", canonicalIdentifier: "10.9.9.9", lifecycleState: "active", verificationState: "verified" } }))).id;
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("scan → manifest → findings → report traces every finding to its asset and scan", async () => {
    scanId = (await createScanFromAssets(ctxA, { name: "exit scan", assetIds: [assetA] })).id;
    const { findings } = await runScanWithSimulatedScanner(ctxA, scanId);
    expect(findings).toBeGreaterThanOrEqual(1);
    const scan = await getScan(ctxA, scanId);
    expect(scan?.status).toBe("COMPLETED");
    const fRows = await withTenant(ORG_A, (tx) => tx.finding.findMany({ where: { scanId } }));
    expect(fRows.length).toBeGreaterThanOrEqual(1);
    for (const f of fRows) {
      expect(f.scanId).toBe(scanId);
      expect(scan?.targets.some((t) => t.assetId === f.assetId)).toBe(true);
    }
  });

  it("report is NOT final until QA-attested (prod)", async () => {
    const report = await buildReport(ctxA, scanId);
    expect(isReportFinal(report)).toBe(false);
    await submitReport(ctxA, report.id);
    const attested = await attestReport(staffA, report.id);
    expect(isReportFinal(attested!)).toBe(true);
  });

  it("cross-tenant isolation: org B sees none of org A's scans, findings, or reports", async () => {
    expect(await getScan(ctxB, scanId)).toBeNull();
    const bFindings = await withTenant(ORG_B, (tx) => tx.finding.findMany({ where: { scanId } }));
    expect(bFindings).toHaveLength(0);
    const bReports = await withTenant(ORG_B, (tx) => tx.report.findMany({}));
    expect(bReports).toHaveLength(0);
  });

  it("every contract path (scans/reports + Phase 4 scope/auth/disputes) maps to a route file", async () => {
    const file = fs.readFileSync(path.join(process.cwd(), "spec", "openapi.yaml"), "utf-8");
    const spec = yaml.load(file) as { paths: Record<string, any> };
    const routeDir = path.join(process.cwd(), "src", "app", "api", "v1");
    const routeFiles = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") routeFiles.add(full);
      }
    };
    walk(routeDir);
    // Prefix match: Phase 3 (scans, reports) + Phase 4 (scope-sets,
    // scope-versions, disputes, findings/.../disputes) contract paths.
    const contractPaths = Object.keys(spec.paths).filter((p) => /^\/(scans|reports|scope-sets|scope-versions|disputes|findings)(\/|$)/.test(p));
    expect(contractPaths.length).toBeGreaterThanOrEqual(5);
    for (const p of contractPaths) {
      const segments = p.split("/").filter(Boolean).map((s) => (s.startsWith("{") ? `[${s.slice(1, -1)}]` : s));
      const expected = path.join(routeDir, ...segments, "route.ts");
      expect(routeFiles.has(expected), `no route file for ${p}`).toBe(true);
    }
  });
});

describe("phase 6 exit criteria: staff identity through the request path", () => {
  const ORG6 = "org_staff_exit6_a_001";
  const USER6 = "user_staff_exit6_a_001";
  const ASSET6 = "asset_staff_exit6_1";
  const ctx6: TenantContext = { userId: USER6, organizationId: ORG6, role: "scan_operator", isStaff: false, appMode: "prod" };

  let scanId6 = "";
  let scanId6b = "";
  let reportId6 = "";
  // A second submitted report lets the fail-closed test hit the STAFF gate
  // (not the status guard) regardless of test order — the attest-success test
  // mutates reportId6's status to "attested".
  let reportId6b = "";

  async function adminWipe6(): Promise<void> {
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await admin.connect();
    try {
      for (const t of ["Dispute", "Authorization", "ReportAttestation", "Report", "ScopeItem", "ScopeVersion", "ScopeSet", "Finding", "ScanTarget", "Scan", "AuditEvent", "Asset", "Session"]) {
        await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [ORG6]);
      }
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG6]);
      await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER6]);
    } finally { await admin.end(); }
  }

  // The portal .env does not set the Keycloak vars (dev); the request path
  // needs an issuer/client for verification, so stub them like the keycloak
  // unit tests do — the claims themselves still come from the jose mock.
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // One Bearer-token request whose verified claims are whatever the test
  // passes — the FULL tenantContextFromRequest path runs (real DB, real
  // resolveTenantContext, real staff overlay; only jose's signature check is
  // mocked). The token "a.b.c" is arbitrary: sessionMetaFromRequest hashes it.
  function requestWithClaims(claims: Record<string, unknown>) {
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: claims,
      protectedHeader: {},
    } as never);
    return {
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "authorization" ? "Bearer a.b.c" : null,
      },
    } as never;
  }

  beforeAll(async () => {
    await adminWipe6();
    await withTenant(ORG6, (tx) => tx.organization.create({ data: { id: ORG6, name: `Exit6 ${ORG6}` } }));
    await withTenant(ORG6, (tx) => tx.user.create({ data: { id: USER6, idpId: "kc-staff-exit6-a", email: "staff6@a.com" } }));
    await withTenant(ORG6, (tx) => tx.organizationMembership.create({
      data: { userId: USER6, organizationId: ORG6, role: "organization_owner" },
    }));
    await withTenant(ORG6, (tx) => tx.asset.create({
      data: { id: ASSET6, organizationId: ORG6, type: "ipv4", canonicalIdentifier: "10.9.9.11", lifecycleState: "active", verificationState: "verified" },
    }));

    // Approved scope version first, then the gated prod scan → findings →
    // report. The report is submitted in beforeAll so the attest tests below
    // exercise the "submitted → attested" prod transition only.
    const set = await createScopeSet(ctx6, { name: "PCI-6" });
    const version = await createScopeVersion(ctx6, set.id, { assetIds: [ASSET6] });
    await submitScopeVersion(ctx6, version.id);
    await approveScopeVersion(ctx6, version.id);
    vi.stubEnv("APP_MODE", "prod");
    try {
      scanId6 = (await createScanFromAssets(ctx6, { name: "run6", assetIds: [ASSET6] })).id;
      scanId6b = (await createScanFromAssets(ctx6, { name: "run6b", assetIds: [ASSET6] })).id;
    } finally { vi.unstubAllEnvs(); }
    for (const sid of [scanId6, scanId6b]) {
      await transitionScanStatus(ctx6, sid, "RUNNING");
      await transitionScanStatus(ctx6, sid, "COMPLETED");
    }
    expect((await ingestFindings(ctx6, scanId6, [{ assetId: ASSET6, qid: "q-exit6", severity: "4", title: "Weak TLS" }])).count).toBe(1);
    const report = await buildReport(ctx6, scanId6);
    expect(report.scopeVersionId).toBe(version.id);
    reportId6 = report.id;
    const reportB = await buildReport(ctx6, scanId6b);
    reportId6b = reportB.id;
    await submitReport(ctx6, reportId6);
    await submitReport(ctx6, reportId6b);
  });

  afterAll(async () => {
    await adminWipe6();
    await prisma.$disconnect();
  });

  it("staff realm-role claim through the request path finalizes a prod report (attested)", async () => {
    vi.stubEnv("APP_MODE", "prod");
    try {
      const ctx = await tenantContextFromRequest(
        requestWithClaims({ sub: "kc-staff-exit6-a", email: "staff6@a.com", realm_access: { roles: ["asv-staff"] } })
      );
      expect(ctx).not.toBeNull();
      expect(ctx?.isStaff).toBe(true); // identity plumbing, not a literal
      const report = await attestReport(ctx!, reportId6);
      expect(report?.status).toBe("attested");
      expect(isReportFinal(report!)).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });

  it("staff realm-role claim through the request path moderates a dispute in prod", async () => {
    const finding = await withTenant(ORG6, (tx) => tx.finding.findFirst({ where: { scanId: scanId6 } }));
    expect(finding).not.toBeNull();
    const dispute = await raiseDispute(ctx6, finding!.id, { justification: "not our host" });
    vi.stubEnv("APP_MODE", "prod");
    try {
      const ctx = await tenantContextFromRequest(
        requestWithClaims({ sub: "kc-staff-exit6-a", email: "staff6@a.com", realm_access: { roles: ["asv-staff"] } })
      );
      expect(ctx?.isStaff).toBe(true);
      const moderated = await moderateDispute(ctx!, dispute.id, { status: "resolved", note: "confirmed" });
      expect(moderated?.status).toBe("resolved");
    } finally { vi.unstubAllEnvs(); }
  });

  it("non-staff claim in prod still fails both gates fail-closed", async () => {
    vi.stubEnv("APP_MODE", "prod");
    try {
      const ctxNS = await tenantContextFromRequest(
        requestWithClaims({ sub: "kc-staff-exit6-a", email: "staff6@a.com" }) // no realm_access → roles []
      );
      expect(ctxNS).not.toBeNull();
      expect(ctxNS?.isStaff).toBe(false);
      await expect(attestReport(ctxNS!, reportId6b)).rejects.toThrow("attestation requires a staff reviewer in prod");
      const finding = await withTenant(ORG6, (tx) => tx.finding.findFirst({ where: { scanId: scanId6 } }));
      const dispute2 = await raiseDispute(ctx6, finding!.id, { justification: "another finding" });
      await expect(moderateDispute(ctxNS!, dispute2.id, { status: "rejected", note: "n" })).rejects.toThrow(
        "dispute moderation requires a staff reviewer in prod"
      );
    } finally { vi.unstubAllEnvs(); }
  });
});
