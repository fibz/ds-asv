# Customer Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the customer-facing portal under `/customer`, with real tenant-scoped dashboard data, canonical customer workflows, report detail/download behavior, and backwards-compatible redirects from the existing shared routes.

**Architecture:** Keep the existing Next.js deployment and API contracts, but add a dedicated customer route tree and layout. Customer pages call small server-side view-model loaders backed by the existing RLS-aware services; legacy dashboard URLs redirect to canonical customer URLs. QSA routes and cross-customer access remain out of scope.

**Tech Stack:** Next.js App Router, TypeScript, React server components, existing Prisma/RLS services, Keycloak cookie/header sessions, Vitest, and the existing portal OpenAPI contract.

**Spec:** `docs/superpowers/specs/2026-09-09-customer-portal-design.md`

## Global Constraints

- The first release keeps both portals in the existing Next.js deployment while separating their route trees and layouts.
- Existing routes remain compatible through redirects, including `/dashboard`, `/assets`, `/scope`, `/scanners`, `/reports`, `/team`, `/access`, `/audit`, and `/settings`.
- API routes remain under `/api/v1/*`; the portal boundary does not move server contracts.
- No customer page may rely on the QSA layout or vice versa.
- No fabricated compliance, scan, or activity values may be shown as live evidence.
- Customer data continues to resolve organization context from the authenticated membership; organization IDs are never accepted from client-controlled route state as an authorization decision.
- The customer portal does not introduce a staff bypass.
- RLS transaction context must be set before every tenant query, including dashboard aggregation and report detail reads.
- A report is labeled `FINAL` only when the existing service rule confirms both QA attestation and approved scope.
- No PCI qualification or compliance claims are introduced.

---

## File Map

### New files

- `portal/src/app/customer/layout.tsx` — authenticated customer shell and customer navigation.
- `portal/src/app/customer/page.tsx` — customer home server page.
- `portal/src/app/customer/assets/page.tsx` — canonical customer asset page.
- `portal/src/app/customer/assets/[id]/page.tsx` — canonical customer asset detail page.
- `portal/src/app/customer/scope/page.tsx` — canonical customer scope page.
- `portal/src/app/customer/scans/page.tsx` — canonical customer scanner page.
- `portal/src/app/customer/reports/page.tsx` — customer report list.
- `portal/src/app/customer/reports/[reportId]/page.tsx` — customer report detail.
- `portal/src/app/customer/team/page.tsx` — canonical customer team page.
- `portal/src/app/customer/access/page.tsx` — canonical customer access page.
- `portal/src/app/customer/audit/page.tsx` — canonical customer audit page.
- `portal/src/app/customer/settings/page.tsx` — canonical customer settings page.
- `portal/src/components/customer/sidebar.tsx` — customer-only navigation and sign-out.
- `portal/src/lib/customer/redirects.ts` — pure legacy-to-canonical customer path mapping.
- `portal/src/components/customer/CustomerHome.tsx` — serialized dashboard view.
- `portal/src/lib/customer/home.ts` — RLS-bound customer home view-model loader.
- `portal/src/lib/customer/home.test.ts` — dashboard data, empty-state, and isolation tests.
- `portal/src/app/api/v1/reports/[reportId]/download/route.ts` — authenticated report JSON download response.
- `portal/src/app/api/v1/reports/[reportId]/download/route.test.ts` — download auth, isolation, and headers tests.

### Modified files

- `portal/src/app/(dashboard)/layout.tsx` — retain compatibility auth while legacy pages redirect into `/customer`.
- `portal/src/app/(dashboard)/dashboard/page.tsx` — redirect `/dashboard` to `/customer`.
- `portal/src/app/(dashboard)/assets/page.tsx` and `[id]/page.tsx` — redirect legacy asset routes.
- `portal/src/app/(dashboard)/scope/page.tsx` — redirect legacy scope route.
- `portal/src/app/(dashboard)/scanners/page.tsx` — redirect legacy scanner route while preserving the existing client component.
- `portal/src/app/(dashboard)/reports/page.tsx` — redirect legacy report list.
- `portal/src/app/(dashboard)/team/page.tsx` — redirect legacy team route.
- `portal/src/app/(dashboard)/access/page.tsx` — redirect legacy access route.
- `portal/src/app/(dashboard)/audit/page.tsx` — redirect legacy audit route.
- `portal/src/app/(dashboard)/settings/page.tsx` — redirect legacy settings route.
- `portal/src/components/dashboard/OrgProfileForm.tsx`, `TeamTable.tsx`, `SessionTable.tsx`, and `MemberInviteForm.tsx` — update internal links only when they point at canonical customer routes.
- `portal/src/app/(dashboard)/scanners/client.tsx` — update customer navigation links and report links without changing scanner authorization.
- `portal/src/lib/openapi/contract.test.ts` and `portal/spec/openapi.yaml` — document the report download endpoint.

---

### Task 1: Add the customer route shell

**Files:**
- Create: `portal/src/app/customer/layout.tsx`
- Create: `portal/src/components/customer/sidebar.tsx`
- Create: `portal/src/app/customer/page.tsx`
- Test: `portal/src/app/customer/layout.test.tsx`

**Interfaces:**
- Consumes: `getKeycloakUser`, `tenantContextFromRequest`, and the existing `headers()`/redirect pattern.
- Produces: an authenticated `/customer` route tree and customer-only navigation links.

- [ ] **Step 1: Write the failing layout tests**

Assert that an unauthenticated request redirects to `/sign-in`, and that the navigation contains only `/customer`, `/customer/assets`, `/customer/scope`, `/customer/scans`, `/customer/reports`, `/customer/team`, `/customer/access`, `/customer/audit`, and `/customer/settings`. The test must not require a database row for the navigation-only assertion.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd portal && ./node_modules/.bin/vitest run src/app/customer/layout.test.tsx`

Expected: FAIL because the customer route shell does not exist.

- [ ] **Step 3: Implement the minimal shell**

Use the existing dashboard shell pattern, but keep the customer sidebar separate:

```tsx
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const user = await getKeycloakUser({ headers: await headers() });
  if (!user) redirect("/sign-in");
  return <div className="min-h-screen bg-gray-100"><CustomerSidebar /><main className="ml-64 p-8">{children}</main></div>;
}
```

The sidebar must not include QSA, WAF, SIEM, API docs, or playground links. The initial customer page may render a small loading-safe shell; dashboard data is implemented in Task 3.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `cd portal && ./node_modules/.bin/vitest run src/app/customer/layout.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/customer/layout.tsx portal/src/app/customer/page.tsx portal/src/components/customer/sidebar.tsx portal/src/app/customer/layout.test.tsx
git commit -m "feat: add customer portal shell"
```

### Task 2: Create canonical customer pages and legacy redirects

**Files:**
- Create: `portal/src/app/customer/assets/page.tsx`
- Create: `portal/src/app/customer/assets/[id]/page.tsx`
- Create: `portal/src/app/customer/scope/page.tsx`
- Create: `portal/src/app/customer/scans/page.tsx`
- Create: `portal/src/app/customer/reports/page.tsx`
- Create: `portal/src/app/customer/team/page.tsx`
- Create: `portal/src/app/customer/access/page.tsx`
- Create: `portal/src/app/customer/audit/page.tsx`
- Create: `portal/src/app/customer/settings/page.tsx`
- Modify: the legacy page files listed in the File Map
- Test: `portal/src/app/customer/redirects.test.ts`

**Interfaces:**
- Consumes: existing page implementations, `DashboardSidebar`-era components, and existing tenant-scoped services.
- Produces: canonical customer URLs, redirect-only legacy pages, and `legacyCustomerPath(pathname: string, search: string): string`.

- [ ] **Step 1: Write redirect tests**

Cover every legacy path in the spec and assert the exact destination:

```ts
expect(legacyCustomerPath("/dashboard", "")).toBe("/customer");
expect(legacyCustomerPath("/reports", "")).toBe("/customer/reports");
expect(legacyCustomerPath("/assets/example", "")).toBe("/customer/assets/example");
```

Also assert that query strings are preserved when a legacy route receives filters.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd portal && ./node_modules/.bin/vitest run src/app/customer/redirects.test.ts`

Expected: FAIL because canonical route modules and redirect helpers are absent.

- [ ] **Step 3: Implement the pure redirect mapper and move page logic behind canonical customer paths**

Create `legacyCustomerPath(pathname, search)` as a pure function. It must map the exact legacy prefixes to the canonical customer prefixes, preserve the dynamic asset/report id segments, and append the original query string unchanged when non-empty. Use this function from the legacy Next page wrappers so the mapping is unit-testable without invoking Next's `redirect` implementation.

Copy the current server-page logic into the new customer paths, preserving existing permission checks and service calls. Update every user-facing link to use `/customer/...`. Do not copy database queries into the layout. Keep `/customer/scans` backed by the existing scanner client and health proxy.

- [ ] **Step 4: Replace old page bodies with redirects**

Each legacy page should contain only a permanent or temporary Next redirect to its canonical customer path. Dynamic asset redirects must preserve the `id` segment; no legacy page should render a second independent customer UI.

- [ ] **Step 5: Run focused tests and TypeScript**

Run: `cd portal && ./node_modules/.bin/vitest run src/app/customer/redirects.test.ts && ./node_modules/.bin/tsc --noEmit`

Expected: PASS with no new route or import errors.

- [ ] **Step 6: Commit**

```bash
git add portal/src/app/customer portal/src/app/'(dashboard)' portal/src/components/dashboard
git commit -m "feat: make customer routes canonical"
```

### Task 3: Build the tenant-scoped customer home loader

**Files:**
- Create: `portal/src/lib/customer/home.ts`
- Create: `portal/src/lib/customer/home.test.ts`

**Interfaces:**
- Consumes: `TenantContext`, Prisma transaction client, `setRlsContext`, `isReportFinal`, and existing organization/asset/scan/report/audit tables.
- Produces:

```ts
export interface CustomerHomeView {
  organization: { id: string; name: string; parentName: string | null };
  assets: { total: number; verified: number; pending: number };
  scans: { total: number; latest: { id: string; name: string; status: string; createdAt: string } | null };
  reports: { total: number; latest: { id: string; status: string; isFinal: boolean; createdAt: string } | null };
  activity: { id: string; action: string; resourceType: string; createdAt: string }[];
}

export function getCustomerHome(ctx: TenantContext): Promise<CustomerHomeView>;
```

- [ ] **Step 1: Write failing data and isolation tests**

Seed two organizations with assets, scans, reports, and audit events. Assert that organization A sees only A's counts and activity, that an empty organization returns zero/null values, and that a report without an approved scope is not marked final.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd portal && ./node_modules/.bin/vitest run src/lib/customer/home.test.ts`

Expected: FAIL because `getCustomerHome` is not defined.

- [ ] **Step 3: Implement one transaction-bound loader**

Use `prisma.$transaction`, call `setRlsContext(ctx.organizationId, tx)` before all reads, and query only rows with `organizationId = ctx.organizationId`. Convert dates to ISO strings before returning. Resolve the latest report's scope version inside the same tenant context and call `isReportFinal` with both `scopeVersionId` and the approved version id.

- [ ] **Step 4: Run focused tests and lint**

Run: `cd portal && ./node_modules/.bin/vitest run src/lib/customer/home.test.ts && ./node_modules/.bin/eslint src/lib/customer/home.ts src/lib/customer/home.test.ts`

Expected: PASS and no lint errors.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/customer/home.ts portal/src/lib/customer/home.test.ts
git commit -m "feat: add tenant-scoped customer home data"
```

### Task 4: Render the real customer home

**Files:**
- Modify: `portal/src/app/customer/page.tsx`
- Create: `portal/src/components/customer/CustomerHome.tsx`
- Test: `portal/src/app/customer/home-page.test.ts`

**Interfaces:**
- Consumes: `tenantContextFromRequest`, `can`, `getCustomerHome`, and `CustomerHomeView`.
- Produces: a serializable customer dashboard with explicit empty/error states and customer-only links.

- [ ] **Step 1: Write page-model tests**

Assert that the page model renders organization name, counts, latest scan/report status, a `FINAL` badge only when `isFinal` is true, and empty-state next actions when all collections are empty. Assert that no hard-coded compliance statuses or fake timestamps are present.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd portal && ./node_modules/.bin/vitest run src/app/customer/home-page.test.ts`

Expected: FAIL because the page still renders the placeholder dashboard.

- [ ] **Step 3: Implement the customer home**

Resolve the authenticated context, redirect unauthenticated requests, call `getCustomerHome`, and pass only plain serializable data to `CustomerHome`. Gate scan/report quick links with `can(ctx, "scan.run")` and `can(ctx, "report.view")`. Render a clear service-error panel if the loader fails; do not substitute sample values.

- [ ] **Step 4: Run focused tests, lint, and TypeScript**

Run: `cd portal && ./node_modules/.bin/vitest run src/app/customer/home-page.test.ts src/lib/customer/home.test.ts && ./node_modules/.bin/eslint src/app/customer/page.tsx src/components/customer/CustomerHome.tsx && ./node_modules/.bin/tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/customer/page.tsx portal/src/components/customer/CustomerHome.tsx portal/src/app/customer/home-page.test.ts
git commit -m "feat: render data-backed customer home"
```

### Task 5: Add customer report detail and download

**Files:**
- Create: `portal/src/app/customer/reports/[reportId]/page.tsx`
- Create: `portal/src/app/api/v1/reports/[reportId]/download/route.ts`
- Create: `portal/src/app/api/v1/reports/[reportId]/download/route.test.ts`
- Modify: `portal/src/app/customer/reports/page.tsx`
- Modify: `portal/src/app/api/v1/reports/[reportId]/route.ts`
- Test: `portal/src/app/customer/reports/report-page.test.ts`

**Interfaces:**
- Consumes: `getReport`, `getScan`, `listFindings`, `getScopeVersion`, `isReportFinal`, `tenantContextFromRequest`, and `can(ctx, "report.view")`.
- Produces: read-only report detail and a JSON attachment response with `Content-Disposition: attachment; filename="report-<id>.json"`.

- [ ] **Step 1: Write route and page tests**

Cover unauthenticated `401`, insufficient permission `403`, a missing report `404`, organization isolation `404` for a report owned by another organization, successful attachment headers, and a detail model containing scope, attestation, finalization, and finding summary fields.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `cd portal && ./node_modules/.bin/vitest run src/app/api/v1/reports/'[reportId]'/download/route.test.ts src/app/customer/reports/report-page.test.ts`

Expected: FAIL because the download route and detail page do not exist.

- [ ] **Step 3: Implement the download route**

Authenticate with `tenantContextFromRequest`, require `report.view`, load the report through `getReport`, load its scan and findings through tenant-scoped services, and return a JSON payload containing report metadata, recorded scope version id, attestation, finalization boolean, and findings. Use `404` for missing or cross-tenant ids and never accept an organization id from query/body input.

- [ ] **Step 4: Implement the detail page and list links**

Create `/customer/reports/[reportId]`, compute scope approval and `isFinal` using the same rule as the existing report list, show finding counts and severity summaries from persisted data, and link the download button to the new endpoint. Update the report list rows to link to the detail page.

- [ ] **Step 5: Run focused tests, lint, and TypeScript**

Run: `cd portal && ./node_modules/.bin/vitest run src/app/api/v1/reports/'[reportId]'/download/route.test.ts src/app/customer/reports/report-page.test.ts src/lib/scan/report.test.ts && ./node_modules/.bin/eslint src/app/customer/reports src/app/api/v1/reports/'[reportId]' && ./node_modules/.bin/tsc --noEmit`

Expected: PASS with the existing report finalization tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add portal/src/app/customer/reports portal/src/app/api/v1/reports
git commit -m "feat: add customer report detail and download"
```

### Task 6: Update customer navigation and scanner/report links

**Files:**
- Modify: `portal/src/app/customer/reports/page.tsx`
- Modify: `portal/src/app/customer/scans/page.tsx`
- Modify: `portal/src/app/(dashboard)/scanners/client.tsx`
- Modify: `portal/src/components/dashboard/OrgProfileForm.tsx`
- Modify: `portal/src/components/dashboard/TeamTable.tsx`
- Modify: `portal/src/components/dashboard/SessionTable.tsx`
- Test: `portal/src/components/customer/navigation.test.ts`

**Interfaces:**
- Consumes: canonical customer paths from Tasks 1–5.
- Produces: no broken internal links after legacy redirects are introduced.

- [ ] **Step 1: Write navigation tests**

Assert that customer links use `/customer/...`, the scanner client links to `/customer/reports`, and no customer navigation link points to `/qsa`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd portal && ./node_modules/.bin/vitest run src/components/customer/navigation.test.ts`

Expected: FAIL on the existing `/reports`, `/team`, `/settings`, and `/dashboard` links.

- [ ] **Step 3: Update links without changing permissions**

Change only destinations and labels. Do not remove existing `can()` checks, scan dispatch behavior, or customer API calls. Keep compatibility redirects as a safety net for external bookmarks.

- [ ] **Step 4: Run focused lint and tests**

Run: `cd portal && ./node_modules/.bin/vitest run src/components/customer/navigation.test.ts && ./node_modules/.bin/eslint src/components/customer src/components/dashboard/OrgProfileForm.tsx src/components/dashboard/TeamTable.tsx src/components/dashboard/SessionTable.tsx src/app/'(dashboard)'/scanners/client.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/customer portal/src/components/dashboard portal/src/app/'(dashboard)'/scanners/client.tsx portal/src/app/customer
git commit -m "feat: point customer workflows at canonical routes"
```

### Task 7: Update the OpenAPI contract and contract tests

**Files:**
- Modify: `portal/spec/openapi.yaml`
- Modify: `portal/src/lib/openapi/contract.test.ts`

**Interfaces:**
- Consumes: the new `GET /v1/reports/{reportId}/download` route.
- Produces: an explicit API contract for authenticated customer report downloads.

- [ ] **Step 1: Add the failing contract assertion**

Add:

```ts
expect(paths["/reports/{reportId}/download"].get).toBeDefined();
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `cd portal && ./node_modules/.bin/vitest run src/lib/openapi/contract.test.ts`

Expected: FAIL because the path is absent from `openapi.yaml`.

- [ ] **Step 3: Document the endpoint**

Describe `401`, `403`, `404`, and `200 application/json` responses; document `Content-Disposition` as an attachment response and reuse the existing report/finding schema references where possible.

- [ ] **Step 4: Run the contract test**

Run: `cd portal && ./node_modules/.bin/vitest run src/lib/openapi/contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/spec/openapi.yaml portal/src/lib/openapi/contract.test.ts
git commit -m "docs: document customer report download"
```

### Task 8: Run full verification and browser smoke path

**Files:**
- Test: existing portal suite and browser-visible customer routes.

**Interfaces:**
- Consumes: all customer route, loader, API, and navigation work from Tasks 1–7.
- Produces: verified customer flow with no QSA implementation mixed into it.

- [ ] **Step 1: Run focused customer tests**

Run:

```bash
cd portal && ./node_modules/.bin/vitest run \
  src/app/customer/layout.test.tsx \
  src/app/customer/redirects.test.ts \
  src/lib/customer/home.test.ts \
  src/app/customer/home-page.test.ts \
  src/app/customer/reports/report-page.test.ts \
  src/app/api/v1/reports/'[reportId]'/download/route.test.ts \
  src/components/customer/navigation.test.ts \
  src/lib/openapi/contract.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run the complete static and unit gates**

Run: `cd portal && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run`

Expected: TypeScript passes and the full existing suite remains green.

- [ ] **Step 3: Start or reuse the local portal with the protected local environment**

Run the existing local dev command with the local `.env` loaded, binding only to `127.0.0.1:3000`. Do not print environment values or secrets.

- [ ] **Step 4: Verify the browser path**

With a real Keycloak customer session, verify:

1. `/customer` renders the organization name and real empty or populated state.
2. `/dashboard` redirects to `/customer`.
3. `/customer/reports` opens the list and a report detail page.
4. The report download response has an attachment filename.
5. `/customer/team`, `/customer/access`, and `/customer/settings` remain reachable according to the logged-in role.
6. A user without `report.view` receives the existing permission behavior.

- [ ] **Step 5: Run final diff review**

Run: `git diff --check` and `git status --short`. Confirm that only customer-portal files from this plan were added or modified by the implementation; preserve unrelated scanner worktree changes.

- [ ] **Step 6: Commit verification notes**

Record the exact focused/full test commands and browser URLs in the task handoff. Do not claim PCI compliance or QSA functionality until those separate milestones are implemented and verified.
