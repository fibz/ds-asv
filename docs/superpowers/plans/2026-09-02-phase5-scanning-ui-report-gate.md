# Phase 5: Scanning UI + Report Finalization Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the control-plane UI through the Phase 4 scope/authorization flow (assets → approved scope → scan → reports) and close the report finalization loop so a report is final only when QA-attested **AND** its linked scope version is approved — per the Phase 4 handoff in AGENTS.md and design spec §5.

**Architecture:** Server-component pages under `app/(dashboard)/` following the existing `/assets` page pattern (server-side auth via `tenantContextFromRequest`, real service calls — no mock data). The report gate is enforced in the service layer (`isReportFinal` = `status === "attested"` AND a linked `Report.scopeVersionId` exists AND is `approved`), and `buildReport` records the scan's approved scope-version linkage at generation time. The `report.view` / `scope.view` / `scan.view` RBAC gates (already in `rbac.ts`) protect the pages; mutations gate through `scope.manage` / `scan.run`.

**Tech Stack:** Next.js 16 + TypeScript, server components, Tailwind v4, Prisma 7 + PostgreSQL RLS, vitest. Same service-layer + route/page conventions as Phases 2–4.

**Spec:** `docs/superpowers/specs/2026-08-29-ds-asv-pci-portal-design.md` (§5 flow steps 4-5 scope-approval gate, step 9-10 report + QA attestation/dispute). Phase 4 plan: `docs/superpowers/plans/2026-08-31-phase4-scope-auth-disputes.md` (delivers the scope/authorization gates this phase wires). **The CVE/scoring source (VulDB/Kali/Greenbone) is deliberately deferred to a Phase 5b plan — it feeds the scanner, not this control-plane work.**

## Global Constraints

- **PostgreSQL RLS on every tenant table.** No NEW tenant table is introduced by Phase 5 (only a new nullable column on the existing `Report` table), so RLS policy/grant work is limited to verifying the `Report` read/write path remains as-is. Do NOT add GRANTs for a rule that doesn't exist.
- **Every migration must preserve `Asset_active_unique`** (`("organizationId","type","canonicalIdentifier") WHERE "lifecycleState" <> 'retired'`) — Prisma `migrate diff` may drop it as drift; re-append if a DROP appears in the diff.
- **Prisma 7 workflow:** never `migrate dev`. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, copy to `<timestamp>_<name>/migration.sql`, `migrate deploy`, `prisma generate`. Generated client is gitignored — regenerate after the migration.
- **Report finalization gate (§5.10):** a report is NOT final until QA-attested (existing `report.status === "attested"`) AND its linked scope version exists AND is `approved`. In prod (`getAppMode() === "prod"`) the gate must hold; dev/test relax via the existing `isReportFinal` semantics but the linkage is always recorded.
- **Immutable approved scope versions:** `buildReport` must link `Report.scopeVersionId` to an approved scope version (or leave null when none exists — e.g. dev-built scans without approved scope). Never re-point an approved report's scope link.
- **`Report.scopeVersionId` is nullable and plain** (no FK is added — scope versions are immutable but a dev-built report may have no link; keep it a `String?` column like `Asset.assetId` precedent). No new relation field on `ScopeVersion` beyond what Phase 4 defined.
- **Auth for pages:** every dashboard page re-checks `tenantContextFromRequest` server-side and `redirect("/sign-in")` if null (the `/assets` page pattern). Do not trust the sidebar — each page validates.
- **RBAC (`can()` is prod-gated):** scope pages gate reads via `can(ctx, "scope.view")` → else an "insufficient permissions" message; mutations gate `scope.manage` / `scope.approve` at the API (already done in Phase 4 — UI only calls them). Scanner page gates `scan.run` for creation and `scan.view` for listing. Reports page gates `report.view`.
- **Test harness rules (established Phase 2–4):** real-DB harnesses (`pg.Client` from `ADMIN_DATABASE_URL`, `withTenant`/`setRlsContext` inside `$transaction`, scoped admin wipes by fixed ids); direct SQL admin inserts into `Organization`/`User` need explicit `"createdAt","updatedAt" ... now(), now()` and `OrganizationMembership`/`Asset` inserts need `"updatedAt" now()` (NOT NULL, no DB default); wipe order children-before-parents; no `any` types (eslint `no-explicit-any`); fixed test ids unique repo-wide (`org_scope5_*` / asset `asset_scope5_*` style).
- **Prod gates read the ENV** via `getAppMode()` (`.` default "dev") — test suites stub `APP_MODE=prod` narrowly with `vi.stubEnv` in try/finally; `ctx.isStaff`/`ctx.appMode` are TenantContext fields set explicitly in tests (resolveTenantContext hardcodes `isStaff:false` — see AGENTS.md known follow-up; pages/prod gates rely on the staff-identity wiring that is deliberately out of scope).
- Baseline: portal 324/324 green (`npx --cache /home/cchock/projects/.npm-cache vitest run` in `portal/`). Scanner untouched by Phase 5.

---

## File Structure

```
portal/
├── prisma/schema.prisma                        # MODIFY (Task 1): Report +scopeVersionId String?
├── prisma/migrations/<ts>_phase5_scope5        # NEW (Task 1)
├── src/lib/scan/service.ts                     # MODIFY (Task 1): expose scope linkage helpers (already has getScan; add getScanScopeVersionId) — or reuse scope service
├── src/lib/scan/report.ts                      # MODIFY (Tasks 1/2): buildReport links scopeVersionId; isReportFinal + gate
├── src/lib/scan/report.test.ts                 # MODIFY (Tasks 1/2): linkage + gate tests
├── src/lib/scan/exit.test.ts                   # MODIFY (Task 6): report-final gate walk / contract
├── src/lib/scope/exit.test.ts                  # MODIFY (Task 6) if needed
├── src/app/(dashboard)/scope/page.tsx          # NEW (Task 3): scope-set list + create + versions + approve
├── src/app/(dashboard)/scope/client.tsx        # NEW (Task 3): interactive create/submit/approve buttons (client component)
├── src/app/(dashboard)/scanners/page.tsx       # MODIFY (Task 4): real approve-scope → scan flow + recent scans
├── src/app/(dashboard)/scanners/client.tsx     # NEW (Task 4): client component for scan creation from scope version
├── src/app/(dashboard)/reports/page.tsx        # NEW (Task 5): list reports w/ status + scope link
├── src/components/dashboard/sidebar.tsx        # MODIFY (Tasks 3/5): add Scope + Reports nav items
├── spec/openapi.yaml                           # MODIFY (Task 2): document scopeVersionId on Report; report-final response
├── src/lib/openapi/contract.test.ts            # MODIFY (Task 2)
├── AGENTS.md                                   # MODIFY (Task 6)
```

---

## Task 1: Report ↔ scope version) linkage

**Files:**
- Modify: `portal/prisma/schema.prisma` (`Report` model)
- Create: `portal/prisma/migrations/<timestamp>_phase5_report_scope/migration.sql`
- Modify: `portal/src/lib/scan/service.ts` (add scope-linkage read helper — keep it thin; the scope domain lives in `@/lib/scope/service`)
- Test: extend `portal/src/lib/scan/report.test.ts`

**Interfaces:**
- Consumes: `withTenant`/`TenantContext` from `@/lib/tenant`; `prisma`; `getScopeVersion`-style reads already in `@/lib/scope/service` (Task 2 of Phase 4: `listScopeSets`, `getScopeVersion`, `approveScopeVersion`, all exported).
- Produces (used by Tasks 2/3/4/5/6):
  - `Report.scopeVersionId String?` (plain nullable column, no FK — a dev-built report may have no scope link)
  - `export async function resolveReportScopeVersionId(ctx, scanId: string): Promise<string | null>` — returns the id of the **latest approved scope version** (per scope set) that contains ANY of the scan's target assetIds, or null if none. Resides in `portal/src/lib/scan/service.ts`. This is the linkage `buildReport` (Task 1 step) records.

- [ ] **Step 1: Write the failing test (extend report.test.ts)**

Add a new describe to `portal/src/lib/scan/report.test.ts` (reuse the file's ORG `org_report_0001`, USER, harness — read the file first; it already seeds org/user/asset, builds a scan, ingests findings):
```ts
describe("report scope linkage (Phase 5)", () => {
  it("resolveReportScopeVersionId returns the latest approved scope version containing a target", async () => {
    const { resolveReportScopeVersionId } = await import("@/lib/scan/service");
    const { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion } = await import("@/lib/scope/service");
    // asset_report_1 already seeded + scan exists in beforeAll (read the existing harness — scanId/assetId are file-scope lets)
    const set = await createScopeSet(ctx, { name: "Scope-Linked" });
    const v1 = await createScopeVersion(ctx, set.id, { assetIds: [assetId] });
    await submitScopeVersion(ctx, v1.id);
    await approveScopeVersion(ctx, v1.id);
    // dev-built scan has no approved-scope gate issue here because this suite is dev; the linkage is still derivable:
    expect(await resolveReportScopeVersionId(ctx, scanId)).toBe(v1.id);
    // a second, later approved version supersedes it
    const v2 = await createScopeVersion(ctx, set.id, { assetIds: [assetId] });
    await submitScopeVersion(ctx, v2.id);
    await approveScopeVersion(ctx, v2.id);
    expect(await resolveReportScopeVersionId(ctx, scanId)).toBe(v2.id);
    // no approved scope → null
    const emptySet = await createScopeSet(ctx, { name: "Empty" });
    await createScopeVersion(ctx, emptySet.id, { assetIds: [assetId] }); // stays draft
    // (assetId is already in an approved version above, so this only proves the function prefers approved; skip a true-null case here)
    expect((await resolveReportScopeVersionId(ctx, scanId)) ?? null).toBeTruthy();
  });
});
```
Adjust to the file's actual variable names (`assetId` comes from the existing beforeAll). The key assertions: latest approved version wins; the function returns a truthy id for a scan whose target is in an approved scope version.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/report.test.ts`
Expected: FAIL — `resolveReportScopeVersionId` is not exported yet (`Cannot find module`/undefined).

- [ ] **Step 3: Add the `Report.scopeVersionId` column**

Add to `portal/prisma/schema.prisma` model `Report` (after `attestationId`):
```prisma
  scopeVersionId   String? // Phase 5: approved scope version that authorized this scan's scope (nullable — dev-built reports may lack one). Plain column, no FK (scope versions are immutable).
```
Then the migration (Prisma 7 diff workflow, per Global Constraints):
```bash
cd portal
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > /tmp/p5.sql
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_phase5_report_scope
cp /tmp/p5.sql prisma/migrations/<timestamp>_phase5_report_scope/migration.sql
```
Confirm the diff adds ONLY `ALTER TABLE "Report" ADD COLUMN "scopeVersionId" TEXT;` (or `TEXT NULL DEFAULT NULL`) — no table drops, no `Asset_active_unique` DROP. If a `DROP INDEX "Asset_active_unique"` appears, re-append the Phase 2 index line. Then:
```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 4: Implement `resolveReportScopeVersionId`**

In `portal/src/lib/scan/service.ts`, add (imports already there for `withTenant`/`prisma`; the scope read needs a scoped query on the tx client):
```ts
/**
 * Phase 5: returns the id of the LATEST approved scope version (per scope set)
 * whose items contain any asset targeted by the given scan. A scan's report
 * links to this approved scope version as the documentation-signed authority
 * behind its scope. Returns null when no approved scope version covers the
 * scan's targets (e.g. dev-built scans).
 */
export async function resolveReportScopeVersionId(ctx: TenantContext, scanId: string): Promise<string | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const targets = await tx.scanTarget.findMany({ where: { scanId, organizationId: ctx.organizationId } });
    if (targets.length === 0) return null;
    const assetIds = targets.map((t) => t.assetId);
    const approved = await tx.scopeVersion.findMany({
      where: { organizationId: ctx.organizationId, status: "approved" },
      orderBy: [{ scopeSetId: "asc" }, { versionNumber: "desc" }],
      include: { items: { where: { assetId: { in: assetIds } } } },
    });
    // latest approved version per scope set
    const seen = new Set<string>();
    for (const v of approved) {
      if (seen.has(v.scopeSetId)) continue;
      seen.add(v.scopeSetId);
      if (v.items.length > 0) return v.id;
    }
    return null;
  });
}
```
(`withTenant` already exists in this file.) Note this matches `assetInApprovedScope`'s latest-approved-per-set semantics (Phase 4 final fix) — the linkage and the gate agree.

Back in `buildReport` (same file, different module — `portal/src/lib/scan/report.ts`), set the linkage at generation time. In `buildReport`, when creating/updating the report, resolve and store the scopeVersionId:
```ts
// inside the withTenant callback, before create/update:
const scopeVersionId = await resolveReportScopeVersionId(ctx, scanId);
// on create:
//   data: { scanId, organizationId: ctx.organizationId, status: "draft", summary: ... , scopeVersionId }
// on update (only set if the report doesn't already have a link — never re-point an approved report):
//   data: { summary: ... , ...(existing.scopeVersionId == null ? { scopeVersionId } : {}) }
```
Import `resolveReportScopeVersionId` from `@/lib/scan/service` in `report.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/report.test.ts`
Expected: PASS — linkage resolves to the latest approved version.

- [ ] **Step 6: Full suite + commit**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run` — green.
```bash
git add portal/prisma/schema.prisma portal/prisma/migrations/<timestamp>_phase5_report_scope/migration.sql portal/src/lib/scan/service.ts portal/src/lib/scan/report.ts portal/src/lib/scan/report.test.ts
git commit -m "feat(portal): Report scope-version linkage — record approved scope version behind each report"
```

---

## Task 2: Report finalization gate (attested AND approved scope)

**Files:**
- Modify: `portal/src/lib/scan/report.ts` (`isReportFinal`, `attestReport` prod gate)
- Modify: `portal/src/lib/scan/report.test.ts`
- Modify: `portal/spec/openapi.yaml`, `portal/src/lib/openapi/contract.test.ts`

**Interfaces:**
- Consumes: `Report.scopeVersionId` (Task 1), `getScopeVersion` from `@/lib/scope/service`, `getAppMode` from `@/lib/tenant`.
- Produces (used by Task 6):
  - `export function isReportFinal(report: { status: string; scopeVersionId?: string | null }): boolean` — now `report.status === "attested"` is NOT sufficient on its own; the final check requires the caller to also pass whether the linked scope version is approved. To keep the signature simple and the gate testable, change it to:
    `export function isReportFinal(report: { status: string; scopeVersionId?: string | null; approvedScopeVersionId?: string | null }): boolean`
    returning `report.status === "attested" && !!report.scopeVersionId && report.scopeVersionId === report.approvedScopeVersionId`. The dashboard passes the approved-scope-version id from the scope service. **Preserve backward compatibility:** if the caller omits `approvedScopeVersionId`, treat a present `scopeVersionId` as approved (legacy checks) — but the exit test must use the full signature.

- [ ] **Step 1: Write the failing gate test**

Append to `portal/src/lib/scan/report.test.ts`:
```ts
describe("report finalization gate (Phase 5)", () => {
  it("report is NOT final unless attested AND its linked scope version is approved", async () => {
    const { buildReport, isReportFinal } = await import("@/lib/scan/report");
    const { approveScopeVersion, createScopeSet, createScopeVersion, submitScopeVersion } = await import("@/lib/scope/service");
    // assetId/scanId from the file's beforeAll
    const set = await createScopeSet(ctx, { name: "Gate" });
    const v = await createScopeVersion(ctx, set.id, { assetIds: [assetId] });
    await submitScopeVersion(ctx, v.id);
    await approveScopeVersion(ctx, v.id);
    const report = await buildReport(ctx, scanId);
    expect(report.scopeVersionId).toBe(v.id); // linkage recorded
    // draft + approved scope → not final
    expect(isReportFinal({ ...{ status: "draft", scopeVersionId: v.id }, approvedScopeVersionId: v.id })).toBe(false);
    // attested + approved scope → final
    expect(isReportFinal({ ...{ status: "attested", scopeVersionId: v.id }, approvedScopeVersionId: v.id })).toBe(true);
    // attested + approved scope but a DIFFERENT/later approved version id → not final (the linked one must be THE approved one)
    expect(isReportFinal({ ...{ status: "attested", scopeVersionId: "other_v" }, approvedScopeVersionId: v.id })).toBe(false);
    // attested + null scope link → not final (dev report with no authority)
    expect(isReportFinal({ status: "attested", scopeVersionId: null, approvedScopeVersionId: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/report.test.ts`
Expected: FAIL — the third/fourth assertions fail under the current `isReportFinal` (attested-only) logic.

- [ ] **Step 3: Implement the gate**

In `portal/src/lib/scan/report.ts`, replace:
```ts
export function isReportFinal(report: { status: string }): boolean {
  return report.status === "attested";
}
```
with the Phase 5 version:
```ts
export function isReportFinal(report: {
  status: string;
  scopeVersionId?: string | null;
  approvedScopeVersionId?: string | null;
}): boolean {
  if (report.status !== "attested") return false;
  // No scope linkage at all → the report lacks documentation-signed authority.
  if (!report.scopeVersionId) return false;
  // Legacy callers omit approvedScopeVersionId: assume the recorded link is the
  // authority (dev/backward-compat). Full callers pass the approved version id.
  return report.approvedScopeVersionId == null
    ? true
    : report.scopeVersionId === report.approvedScopeVersionId;
}
```
Also add a **prod guard** in `attestReport` (opt-in via env, matching how the prod gate reads the ENV): before marking attested, when `getAppMode() === "prod"`, reject if the report's linked scope version is not approved:
```ts
if (getAppMode() === "prod") {
  const scopeV = report.scopeVersionId
    ? (await getScopeVersion(ctx, report.scopeVersionId))
    : null;
  if (!scopeV || scopeV.status !== "approved") {
    throw new ReportGuardError("cannot attest: report has no approved scope version (required in prod)");
  }
}
```
`getScopeVersion` is imported from `@/lib/scope/service`. (Dev/test: gate relaxed, per Global Constraints.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/report.test.ts`
Expected: PASS (new gate tests + existing Phase 3 report tests still green — the legacy `isReportFinal({ status })` call sites in the report route use the backward-compat branch).

- [ ] **Step 5: Document the scopeVersionId on the contract**

In `portal/spec/openapi.yaml`, add `scopeVersionId` to the `Report` schema (nullable string). Add a note on the report-final semantics. Extend `portal/src/lib/openapi/contract.test.ts` to assert the `Report` schema has `scopeVersionId`.

- [ ] **Step 6: Full suite + commit**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run` — green.
```bash
git add portal/src/lib/scan/report.ts portal/src/lib/scan/report.test.ts portal/spec/openapi.yaml portal/src/lib/openapi/contract.test.ts
git commit -m "feat(portal): report finalization gate — attested AND approved scope version"
```

---

## Task 3: Scope management UI (`/scope`)

**Files:**
- Create: `portal/src/app/(dashboard)/scope/page.tsx` (server component)
- Create: `portal/src/app/(dashboard)/scope/client.tsx` (client component: create set, create version from assets, submit/approve)
- Modify: `portal/src/components/dashboard/sidebar.tsx` (add `Scope` → `/scope`)

**Interfaces:**
- Consumes: `listScopeSets`, `createScopeSet`, `createScopeVersion`, `submitScopeVersion`, `approveScopeVersion`, `getScopeVersion` from `@/lib/scope/service`; `listAssets` from `@/lib/assets/service`; `tenantContextFromRequest` from `@/lib/tenant`; `can` from `@/lib/auth/rbac`.
- Produces (used by Task 4): the UI the scanner flow navigates through; the approved scope version is the entity the scanner page consumes.

- [ ] **Step 1: Add the sidebar entry**

In `portal/src/components/dashboard/sidebar.tsx`, add `{ name: "Scope", href: "/scope" }` after `Assets` (find the nav array). The sidebar already maps `item.href` — no further change needed.

- [ ] **Step 2: Write the server page**

Create `portal/src/app/(dashboard)/scope/page.tsx` following `assets/page.tsx` exactly (server component, `tenantContextFromRequest` → redirect, call the scope service, render). It lists scope sets with their versions (status, versionNumber, contentHash when approved), and renders the client component for creation/actions:
```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest } from "@/lib/tenant";
import { listScopeSets } from "@/lib/scope/service";
import { listAssets } from "@/lib/assets/service";
import { ScopeClient } from "./client";

export default async function ScopePage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const scopeSets = await listScopeSets(ctx);   // includes versions (Phase 4: include versions desc)
  const assets = await listAssets(ctx, {});     // for the "create version from assets" picker
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Scope</h1>
        <p className="text-gray-600">Immutable, versioned scope — no scan runs without an approved scope version.</p>
      </div>
      <ScopeClient scopeSets={scopeSets} assets={assets} />
    </div>
  );
}
```

- [ ] **Step 3: Write the client component**

Create `portal/src/app/(dashboard)/scope/client.tsx` ("use client"): a controlled component with:
- A "New scope set" form (name + optional description) → `POST /api/v1/scope-sets`.
- Per scope set: a "New version" form that lists assets as checkboxes (from the server-passed `assets`) → `POST /api/v1/scope-sets/{scopeSetId}/versions` with `{ assetIds }`.
- Per draft/submitted version: **Submit** (draft→submitted, needs `scope.manage`) and **Approve** (submitted→approved, needs `scope.approve`) buttons → the Phase 4 routes. Disable/hide approve for non-owner/security_admin per the passed ctx role (or just surface the 403; keep it simple — buttons call the API, the API enforces the gate).
- On any action, `router.refresh()` to re-pull the server list.
Use `fetch` with the `Authorization: Bearer <token>` header from a shared helper (check how `/assets` does it — it uses server components; for client mutations, read the token from a cookie/header you already have, or use the `X-API-Key` machine path; the simplest correct approach that matches the existing auth is to call the API routes which read the same Bearer header the page's session provides — for the client form, use `fetch` with the token from a `useState`/`cookies()`-exposed value, matching any existing client mutation pattern in the repo). Keep it minimal and consistent with whatever the repo already does for client-side mutation (there is a `/playground` and onboarding page — mirror those).

- [ ] **Step 4: Manual/A11y smoke + lint + commit**

Run `npx eslint` on the new files. Verify the page renders (no compile error) via the dev test that imports it isn't feasible in vitest for pages — rely on eslint + the fact that the server component calls only exported functions. (No vitest UI test — the Phase 2–4 UI pages have none; conformance is via the API tests already green.)
```bash
git add portal/src/components/dashboard/sidebar.tsx "portal/src/app/(dashboard)/scope/page.tsx" "portal/src/app/(dashboard)/scope/client.tsx"
git commit -m "feat(portal): scope management UI — sets, versioned snapshots, submit/approve"
```

---

## Task 4: Scanner page rewiring (approved scope → scan)

**Files:**
- Modify: `portal/src/app/(dashboard)/scanners/page.tsx` (server component: fetch approved scope versions + recent scans)
- Create: `portal/src/app/(dashboard)/scanners/client.tsx` (client component: pick an approved scope version, run the scan)

**Interfaces:**
- Consumes: `listScopeSets`/`getScopeVersion` from `@/lib/scope/service` (to get approved versions and their items); `listScans`/`getScan` from `@/lib/scan/service`; `POST /api/v1/scans` (`createScanFromAssets`, gate `scan.run`).
- Produces (used by Task 5): the run flow that produces scans whose reports Task 5 lists.

- [ ] **Step 1: Rewrite the server page**

Replace the body of `portal/src/app/(dashboard)/scanners/page.tsx` (it currently has a hardcoded demo). Server component: authenticate, list approved scope versions (from `listScopeSets` → filter versions with `status === "approved"`, flatten), list recent scans (`listScans`), and render `<ScannerClient approvedVersions=... scans=... />`.

- [ ] **Step 2: Write the client component**

Create `portal/src/app/(dashboard)/scanners/client.tsx` ("use client"): a dropdown of **approved scope versions** (labeled with the scope set name + version number), a scan name input, and a **Run Scan** button → `POST /api/v1/scans` with `{ name, assetIds }` where `assetIds` = the approved version's item assetIds. On 201, `router.refresh()`. Render the real recent scans list (name, status, target count) instead of the hardcoded rows. If no approved scope version exists, show an informative empty state ("No approved scope yet — define and approve scope under **Scope**.") that links to `/scope`.

- [ ] **Step 3: lint + commit**

Run `npx eslint` on both files. No vitest UI test needed (APIs already covered).
```bash
git add "portal/src/app/(dashboard)/scanners/page.tsx" "portal/src/app/(dashboard)/scanners/client.tsx"
git commit -m "feat(portal): scanner flow wired to approved scope versions (assets → scope → scan)"
```

---

## Task 5: Reports UI (`/reports`)

**Files:**
- Create: `portal/src/app/(dashboard)/reports/page.tsx` (server component)
- Modify: `portal/src/components/dashboard/sidebar.tsx` (add `Reports` → `/reports`)

**Interfaces:**
- Consumes: `getReport`/`buildReport`-adjacent reads, `listScans`/`getScan` from `@/lib/scan/service`; `isReportFinal` from `@/lib/scan/report`; a report-per-scan listing helper.

- [ ] **Step 1: Add the sidebar entry**

In `portal/src/components/dashboard/sidebar.tsx`, add `{ name: "Reports", href: "/reports" }` (after `Scanners`).

- [ ] **Step 2: Add a report-listing read**

Phase 3 has `getReport(scanId)` (single) — add a thin `listReports(ctx)` to `portal/src/lib/scan/report.ts` (org-scoped `tx.report.findMany` with `include: { attestation: true }`, orderBy createdAt desc). It must also surface each report's `scopeVersionId` and, in the page, look up that scope version's approval status for the final-gate display.

- [ ] **Step 3: Write the server page**

Create `portal/src/app/(dashboard)/reports/page.tsx`: authenticate, `listReports(ctx)`, and for each report compute `isReportFinal({ status, scopeVersionId, approvedScopeVersionId })` where `approvedScopeVersionId` comes from resolving the report's `scopeVersionId` via `getScopeVersion` (or `null` if unlinkable). Render a table: scan name, status, scope link (scope set + version or "none"), attestation status, and a **FINAL** badge when the gate passes. Show the "not final until attested ✓ AND approved scope ✓" legend so operators see exactly what the gate requires.

- [ ] **Step 4: lint + commit**

Run `npx eslint`. Add a contract/type test only if a new service function is exported (add one `describe` to `portal/src/lib/scan/report.test.ts` asserting `listReports` returns org-scoped rows) — follow Task 1's harness.
```bash
git add "portal/src/app/(dashboard)/reports/page.tsx" portal/src/components/dashboard/sidebar.tsx portal/src/lib/scan/report.ts portal/src/lib/scan/report.test.ts
git commit -m "feat(portal): reports UI — status, scope link, finalization gate badge"
```

---

## Task 6: Exit criteria + handoff

**Files:**
- Modify: `portal/src/lib/scope/exit.test.ts` (extend the Phase 4 exit proof: report final requires approved scope)
- Modify: `portal/src/lib/scan/exit.test.ts` (add the report-final gate walk / scope link to the contract walk regex if new `/reports` route paths are added — no new API paths are added by Phase 5, so this stays as-is unless the walk regex needs `/findings` already covered)
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Tasks 1–5.

- [ ] **Step 1: Extend the exit proof**

In `portal/src/lib/scope/exit.test.ts`, within the existing end-to-end test (it already approves a scope version, runs a scan via the gate, ingests findings), add report-final assertions:
```ts
// After the scan completes and a finding is ingested (existing steps):
const { buildReport, isReportFinal } = await import("@/lib/scan/report");
const linkedReport = await buildReport(ctxA, scanId);
// linkage recorded to the approved scope version
expect(linkedReport.scopeVersionId).toBe(version.id);
// draft + approved scope → not final
expect(isReportFinal({ status: linkedReport.status, scopeVersionId: version.id, approvedScopeVersionId: version.id })).toBe(false);
```
Then a dedicated gate test (`describe` or a new `it`) that proves a report is final ONLY after both attestation and approved scope:
```ts
it("report is final only when attested AND its scope version is approved (gate)", async () => {
  const { buildReport, submitReport, attestReport, isReportFinal } = await import("@/lib/scan/report");
  const { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion } = await import("@/lib/scope/service");
  // Use the existing approved-scope + scan from beforeAll; build a report over that scan.
  const set = await createScopeSet(ctxA, { name: "Final-Gate" });
  const v = await createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_exit_1"] });
  await submitScopeVersion(ctxA, v.id);
  await approveScopeVersion(ctxA, v.id);
  // scan already created in the first test over asset_scope_exit_1 (share via a file-scoped let)
  const report = await buildReport(ctxA, scanId /* reuse */);
  const before = isReportFinal({ status: report.status, scopeVersionId: v.id, approvedScopeVersionId: v.id });
  expect(before).toBe(false); // draft
  await submitReport(ctxA, report.id);
  const attested = await attestReport(staffA, report.id); // staffA exists in this harness
  expect(attested?.status).toBe("attested");
  const withScope = isReportFinal({ status: attested!.status, scopeVersionId: v.id, approvedScopeVersionId: v.id });
  expect(withScope).toBe(true); // attested AND approved scope
  const wrongScope = isReportFinal({ status: attested!.status, scopeVersionId: "stale", approvedScopeVersionId: v.id });
  expect(wrongScope).toBe(false); // linked scope not the approved one
});
```
Adapt to the file's actual `staffA`/ctx names and reuse the scan created in the first test (make `scanId` a file-scoped `let` if it isn't already). Note the prod attestation gate requires `staffA` (isStaff:true) — already present in `scope/exit.test.ts`.

- [ ] **Step 2: Run exit tests + full suite twice**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scope/exit.test.ts src/lib/scan/exit.test.ts` → PASS.
Then full suite TWICE: `npx --cache /home/cchock/projects/.npm-cache vitest run` → green both times (no idpId/parallel flake). Record the ACTUAL count.

- [ ] **Step 3: Update AGENTS.md**

Replace the `- **NEXT:** Phase 5 = ... UI wiring ...` line with a `- **Phase 5 DONE** (...)` bullet (scanning UI wiring via approved scope versions, report-finalization gate = attested AND approved scope, reports UI with gate badge) + `- **NEXT:** Phase 5b = CVE/scoring source (VulDB/Kali/Greenbone local DBs feeding cveId/severity/pciSeverity into findings)` — the deferred item. Update the test-count line with your actual full-suite result.

- [ ] **Step 4: Commit**

```bash
git add portal/src/lib/scope/exit.test.ts portal/src/lib/scan/exit.test.ts AGENTS.md
git commit -m "test(portal): Phase 5 exit criteria — report final only when attested AND scope approved; docs: handoff"
```

---

## Self-Review

**Spec coverage:** §5.10 report-finalization gate → Task 2 (attested AND approved-scope semantics + prod guard). §5.4-5 scope-approval flow → tasks 1 (`buildReport` links the approved scope version) + 3 (scope UI). §5.6-8 scan execution UI → Task 4. §5.9-10 report + QA UI → Task 5. Exit criteria → Task 6. CVE/scoring (spec §5.7-8, Phase 3b deferral) → explicitly deferred to Phase 5b, not silently dropped.

**Placeholder scan:** every task carries exact code/commands; no TBD. Task 3/4/5 UI pages have no vitest harness precedent (Phase 2–4 shipped UI without page tests) — validated by eslint + the underlying API tests + the exit proof, mirroring the accepted Phase 2–4 approach.

**Type consistency:** `resolveReportScopeVersionId(ctx, scanId): Promise<string | null>` (Task 1) used in `buildReport` (Task 1) and exit (Task 6). `isReportFinal({status, scopeVersionId?, approvedScopeVersionId?})` (Task 2) used in Task 5 (reports page) and Task 6. `listReports(ctx)` (Task 5) used only in Task 5. `Report.scopeVersionId string?` referenced in Tasks 1/2/5/6.

---

## Handoff note for Phase 5b

Phase 5 delivers the control-plane GUI over the existing gates: operators define/approve immutable scope versions (`/scope`), run scans against them (`/scanners`), and see report finalization status with an explicit "attested ✓ AND approved scope ✓" badge (`/reports`). The report-finalization gate is now enforced in the service layer (`isReportFinal` + prod attest barrier). Next: the **CVE/scoring source** (VulDB or Kali/Greenbone local DBs, feeding `cveId`/`severity`/`pciSeverity` into findings — deferred from Phase 3b), which lives in the scanner service, not the control-plane portal, and should get its own spec + plan.
