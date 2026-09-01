import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Client } from "pg";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets, transitionScanStatus } from "@/lib/scan/service";
import { ingestFindings } from "@/lib/scan/findings";
import { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion, assetInApprovedScope } from "@/lib/scope/service";
import { buildReport, submitReport, attestReport, isReportFinal } from "@/lib/scan/report";
import { issueAuthorization, verifyAuthorizationSignature, getAuthorization } from "@/lib/scope/authorization";
import { raiseDispute, moderateDispute, listDisputes } from "@/lib/disputes/service";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG_A = "org_scope_exit_a_001";
const ORG_B = "org_scope_exit_b_001";
const USER_A = "user_scope_exit_a_001";
const USER_B = "user_scope_exit_b_001";
const ASSET = "asset_scope_exit_1";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

// TenantContext literals, exactly like scan/exit.test.ts: no memberships
// seeded, no resolveTenantContext — the service layer runs off these. The prod
// gate (createScanFromAssets) and the moderation staff gate
// (moderateDispute) read the ENV via getAppMode(), NOT ctx.appMode, so the
// prod assertions stub APP_MODE=prod narrowly (see scan/service.test.ts:94).
const ctxA: TenantContext = { userId: USER_A, organizationId: ORG_A, role: "scan_operator", isStaff: false, appMode: "prod" };
const staffA: TenantContext = { ...ctxA, isStaff: true };
const ctxB: TenantContext = { userId: USER_B, organizationId: ORG_B, role: "scan_operator", isStaff: false, appMode: "prod" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG_A, ORG_B]) {
      // dependency order: disputes/authorizations/scope rows before findings/
      // scans/assets; AuditEvent is append-only (organizationId only).
      for (const t of ["Dispute", "Authorization", "ReportAttestation", "Report", "ScopeItem", "ScopeVersion", "ScopeSet", "Finding", "ScanTarget", "Scan", "AuditEvent", "Asset"]) {
        await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [o]);
      }
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id IN ($1, $2)`, [USER_A, USER_B]);
  } finally { await admin.end(); }
}

describe("phase 4 + phase 5 exit criteria", () => {
  let scanId = "";
  // Phase 5 gate tests (below) reuse the scope version approved in the first
  // test — its id is file-scoped so the dedicated gate test can prove the
  // strict report-finalization check against the REAL approved version id.
  let approvedVersionId = "";
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG_A, ORG_B]) await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Exit ${o}` } }));
    // distinct idpIds (kc-scope-exit-a/b) so parallel workers never collide
    // with scan/exit.test.ts's kc-scan-exit-a/b on the shared DB.
    await withTenant(ORG_A, (tx) => tx.user.create({ data: { id: USER_A, idpId: "kc-scope-exit-a", email: "a@x.com" } }));
    await withTenant(ORG_B, (tx) => tx.user.create({ data: { id: USER_B, idpId: "kc-scope-exit-b", email: "b@x.com" } }));
    await withTenant(ORG_A, (tx) => tx.asset.create({
      data: { id: ASSET, organizationId: ORG_A, type: "ipv4", canonicalIdentifier: "10.9.9.10", lifecycleState: "active", verificationState: "verified" },
    }));
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("zero-scan until an approved scope version; gate + signed authorization + dispute end-to-end", async () => {
    // 1. Prod gate blocks the unapproved scan (asset verified but NOT in any
    // approved scope version yet → the scope gate fires, before any scan row).
    vi.stubEnv("APP_MODE", "prod");
    try {
      await expect(createScanFromAssets(ctxA, { name: "no", assetIds: [ASSET] })).rejects.toThrow(/approved scope version/i);
    } finally { vi.unstubAllEnvs(); }

    // 2. Approve a scope version → the gate now passes in prod; org B (whose
    // approved scope never contained this asset) still sees it out of scope.
    const set = await createScopeSet(ctxA, { name: "PCI" });
    const version = await createScopeVersion(ctxA, set.id, { assetIds: [ASSET] });
    await submitScopeVersion(ctxA, version.id);
    await approveScopeVersion(ctxA, version.id);
    expect(await assetInApprovedScope(ctxA, ASSET)).toBe(true);
    expect(await assetInApprovedScope(ctxB, ASSET)).toBe(false);

    vi.stubEnv("APP_MODE", "prod");
    try {
      scanId = (await createScanFromAssets(ctxA, { name: "run", assetIds: [ASSET] })).id;
    } finally { vi.unstubAllEnvs(); }
    await transitionScanStatus(ctxA, scanId, "RUNNING");
    await transitionScanStatus(ctxA, scanId, "COMPLETED");
    expect((await ingestFindings(ctxA, scanId, [{ assetId: ASSET, qid: "q-exit", severity: "4", title: "Weak TLS" }])).count).toBe(1);

    // 3. Phase 5 report-finalization gate (draft side): a report built over
    // the gate-approved scan links to the approved scope version, but a draft —
    // even with an approved scope — is never final.
    const linkedReport = await buildReport(ctxA, scanId);
    expect(linkedReport.scopeVersionId).toBe(version.id); // linkage → approved version
    expect(isReportFinal({ status: linkedReport.status, scopeVersionId: version.id, approvedScopeVersionId: version.id })).toBe(false);
    approvedVersionId = version.id; // hand the approved id to the Phase 5 gate test

    // 4. Issued authorization verifies and is bound to the frozen scope hash.
    const auth = await issueAuthorization(ctxA, version.id);
    expect(verifyAuthorizationSignature(auth)).toBe(true);
    expect(auth.scopeVersionHash).toBe(version.contentHash);
    expect((await getAuthorization(ctxA, version.id))?.id).toBe(auth.id);

    // 5. Dispute raised (dev env), then moderated only by staff in prod.
    const findingRow = await prisma.$transaction(async (tx) => {
      await setRlsContext(ORG_A, tx);
      return (await tx.finding.findFirst({ where: { scanId } }))!;
    });
    const d = await raiseDispute(ctxA, findingRow.id, { justification: "not our host" });
    let moderated: Awaited<ReturnType<typeof moderateDispute>> = null;
    vi.stubEnv("APP_MODE", "prod");
    try {
      await expect(moderateDispute(ctxA, d.id, { status: "rejected", note: "n" })).rejects.toThrow(/staff/i);
      moderated = await moderateDispute(staffA, d.id, { status: "resolved", note: "confirmed" });
    } finally { vi.unstubAllEnvs(); }
    expect(moderated?.status).toBe("resolved");
    expect((await listDisputes(ctxA, { findingId: findingRow.id })).length).toBeGreaterThanOrEqual(1);
  });

  it("Phase 5 gate: report is final only when attested AND its scope version is approved", async () => {
    // Reuses the gate-approved scan + scope version from the first test:
    // buildReport resolves the same approved version, so the strict
    // approvedScopeVersionId = version.id check below is the real one.
    const report = await buildReport(ctxA, scanId);
    expect(report.scopeVersionId).toBe(approvedVersionId);
    // draft + approved scope → not final
    expect(isReportFinal({ status: report.status, scopeVersionId: approvedVersionId, approvedScopeVersionId: approvedVersionId })).toBe(false);

    await submitReport(ctxA, report.id);
    // Attest in PROD (full gate): the prod attest guard requires BOTH a staff
    // reviewer AND the report's linked scope version to be approved — this
    // passes only because test 1 approved the scope version this scan ran under.
    let attested: Awaited<ReturnType<typeof attestReport>> = null;
    vi.stubEnv("APP_MODE", "prod");
    try {
      attested = await attestReport(staffA, report.id);
    } finally { vi.unstubAllEnvs(); }
    expect(attested?.status).toBe("attested");

    // attested AND the approved scope version → FINAL (strict semantics)
    expect(isReportFinal({ status: attested!.status, scopeVersionId: approvedVersionId, approvedScopeVersionId: approvedVersionId })).toBe(true);
    // attested but linked to a scope version that is NOT the approved one → not final
    expect(isReportFinal({ status: attested!.status, scopeVersionId: "stale", approvedScopeVersionId: approvedVersionId })).toBe(false);
    // attested but NO scope link at all (strict caller) → not final
    expect(isReportFinal({ status: attested!.status, scopeVersionId: null, approvedScopeVersionId: approvedVersionId })).toBe(false);
    // approved scope but NOT attested → not final
    expect(isReportFinal({ status: "submitted", scopeVersionId: approvedVersionId, approvedScopeVersionId: approvedVersionId })).toBe(false);
  });

  it("contract routes exist for scope/auth/disputes", () => {
    const file = fs.readFileSync(path.join(process.cwd(), "spec", "openapi.yaml"), "utf-8");
    const spec = yaml.load(file) as { paths: Record<string, any> };
    const phase4Paths = [
      "/scope-sets",
      "/scope-sets/{scopeSetId}/versions",
      "/scope-versions/{versionId}/submit",
      "/scope-versions/{versionId}/approve",
      "/scope-versions/{versionId}/authorization",
      "/findings/{findingId}/disputes",
      "/disputes/{disputeId}/moderate",
    ];
    for (const p of phase4Paths) expect(spec.paths?.[p], `missing path ${p}`).toBeDefined();
    // Mirror the scan/exit walk: every contract path must map to a real route
    // file ({param} → [param]) — the brief's buggy string-replace assertion
    // (".../disputes/" against FILE paths) is replaced by this conformance walk.
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
    for (const p of phase4Paths) {
      const segments = p.split("/").filter(Boolean).map((s) => (s.startsWith("{") ? `[${s.slice(1, -1)}]` : s));
      const expected = path.join(routeDir, ...segments, "route.ts");
      expect(routeFiles.has(expected), `no route file for ${p}`).toBe(true);
    }
  });
});