# Phase 6: Prod Staff Identity → Report (and Dispute) Finalization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the prod staff gates reachable — wire a real staff-identity path (Keycloak realm role claim, with a dev/test env override) into `TenantContext.isStaff`, so `attestReport` (report FINAL in prod) and `moderateDispute` (QA moderation in prod) stop being 409-forever and reports can actually reach FINAL in production.

**Architecture:** The portal already verifies Keycloak tokens (`verifyToken` in `auth/keycloak.ts`) and returns the full claims payload — but `getUserFromClaims`/`provisionUserFromClaims` discard everything except `sub` + `email`, and `resolveTenantContext` hardcodes `isStaff: false` (tenant.ts:81). This phase threads the realm-role claim through: `KeycloakUser` gains `roles: string[]` (parsed from `realm_access.roles`), a new `resolvesAsStaff(roles)` honors the `STAFF_ROLE` env (default `asv-staff`) in ALL modes plus a `STAFF_USER_IDS` dev/test-only override (comma-separated idpId or email), and `tenantContextFromRequest` overlays the computed `isStaff` onto the resolved ctx. The two existing gates (`report.ts attestReport`, `disputes/service.ts moderateDispute`) are untouched — they already read `ctx.isStaff`; they simply become reachable.

**Tech Stack:** Next.js 16 + TypeScript, `jose` (already used for JWKS/RS256 verification), vitest, existing route tests that mock `jose`. No DB/migration changes.

**Spec:** `docs/superpowers/specs/2026-08-29-ds-asv-pci-portal-design.md` (§5 step 9-10 QA attestation; §2 control-plane auth). Follow-up tracked in AGENTS.md ("Staff identity wiring ... fail-closed until then").

## Global Constraints

- **Prod = the Keycloak claim only.** In `getAppMode() === "prod"`, `isStaff` MUST come from the verified realm role (`realm_access.roles` contains `STAFF_ROLE`); the `STAFF_USER_IDS` override is honored in dev/test ONLY (fail-closed in prod — an env list must never grant staff in production).
- **Security defaults:** a token with no `realm_access` claim, a malformed roles array, or no `STAFF_ROLE` env match → `isStaff: false`. Never throw on an absent/malformed claim — treat it as "not staff" (the claim is attestation-denial, not an auth failure). Verified tokens with valid signatures but a non-staff role remain staff-denied.
- **Fail-closed, unchanged gates:** do NOT modify `attestReport` (report.ts:110-ish) or `moderateDispute` (disputes/service.ts) gate logic, their exact messages, or their ENV-read behavior. This phase makes them reachable; their rejections for non-staff stay identical.
- **Backward compatibility:** `KeycloakUser` gains a `roles` field — any test constructing a `KeycloakUser` literal must set `roles: []` (or `roles: [...]`); `getUserFromClaims`/`provisionUserFromClaims` signatures unchanged in call shape (they return the enriched object). `resolveTenantContext(userId)` keeps hardcoding `isStaff: false` — the overlay happens in `tenantContextFromRequest`, so service-level tests building `TenantContext` literals (Phases 3-5 harnesses) are untouched.
- **Env knobs:** `STAFF_ROLE` (default `"asv-staff"`), `STAFF_USER_IDS` (comma-separated idpId or email, dev/test only). `.env.example` gains both with comments.
- **No `any`** (eslint no-explicit-any); existing route tests use `vi.mocked(jose)` with `{ payload: CLAIMS }` — staff-flag tests ADD `realm_access` to the mocked claims; existing non-staff mocks (no realm_access) keep working unchanged.
- Baseline: portal 335/335 green (`npx --cache /home/cchock/projects/.npm-cache vitest run` in `portal/`). Scanner untouched by Phase 6.

---

## File Structure

```
portal/
├── src/lib/auth/keycloak.ts                  # MODIFY (Task 1): KeycloakUser +roles; parse realm_access.roles
├── src/lib/auth/keycloak.test.ts             # MODIFY (Task 1): claim/roles parse tests
├── src/lib/tenant.ts                         # MODIFY (Task 2): resolvesAsStaff + STAFF_ROLE/STAFF_USER_IDS + overlay in tenantContextFromRequest
├── src/lib/tenant.test.ts                    # MODIFY (Task 2): resolution + overlay tests
├── .env.example                              # MODIFY (Task 2): STAFF_ROLE + STAFF_USER_IDS comments
├── src/app/api/v1/reports/[reportId]/attest/route.test.ts   # MODIFY/ADD (Task 3): route-level staff-claim proof
├── src/lib/scan/exit.test.ts                 # MODIFY (Task 4): staff-claim end-to-end attest + dispute
├── AGENTS.md                                 # MODIFY (Task 4): Phase 6 DONE + runnability flip
```

---

## Task 1: Parse the realm-role claim into KeycloakUser.roles

**Files:**
- Modify: `portal/src/lib/auth/keycloak.ts`
- Test: `portal/src/lib/auth/keycloak.test.ts`

**Interfaces:**
- Consumes: `verifyToken` (returns `Record<string, unknown>` claims — realm_access.roles present in Keycloak JWTs); existing `getUserFromClaims`/`provisionUserFromClaims`/`provisionKeycloakUser`.
- Produces (used by Task 2):
  - `KeycloakUser` gains `roles: string[]` (lowercased realm roles; empty when `realm_access` absent/malformed).
  - `export function realmRoles(claims: Record<string, unknown>): string[]` — pure claim → roles; never throws.

- [ ] **Step 1: Write the failing tests**

Extend `portal/src/lib/auth/keycloak.test.ts` (read it first — it mocks `jose` and prisma, and has a `makeClaims`-style fixture; follow its conventions):
```ts
describe("realm roles claim", () => {
  it("parses realm_access.roles (lowercased) from verified claims", () => {
    const { realmRoles } = await import("@/lib/auth/keycloak");
    const claims = { sub: "u1", email: "a@x.com", realm_access: { roles: ["asv-staff", "offline_access"] } };
    expect(realmRoles(claims)).toEqual(["asv-staff", "offline_access"]);
  });

  it("returns [] when realm_access is absent, empty, or malformed (never throws)", () => {
    const { realmRoles } = await import("@/lib/auth/keycloak");
    expect(realmRoles({ sub: "u1", email: "a@x.com" })).toEqual([]);
    expect(realmRoles({ realm_access: null })).toEqual([]);
    expect(realmRoles({ realm_access: { roles: "not-an-array" } })).toEqual([]);
  });

  it("KeycloakUser carries roles from provisionUserFromClaims", async () => {
    // extend an existing provisioning test: mock verifyToken claims WITH realm_access,
    // assert the returned KeycloakUser.roles equals the claim roles.
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/auth/keycloak.test.ts`
Expected: FAIL — `realmRoles` not exported; `KeycloakUser` has no `roles`.

- [ ] **Step 3: Implement**

In `portal/src/lib/auth/keycloak.ts`:
```ts
export interface KeycloakUser {
  idpId: string;
  email: string;
  roles: string[];
}

/** Pure claim → realm roles extractor. Never throws: an absent/malformed
 * realm_access is "no roles", which the caller treats as not-staff. */
export function realmRoles(claims: Record<string, unknown>): string[] {
  const ra = claims?.realm_access;
  if (!ra || typeof ra !== "object" || Array.isArray(ra)) return [];
  const roles = (ra as Record<string, unknown>).roles;
  if (!Array.isArray(roles)) return [];
  return roles
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.toLowerCase());
}
```
In `getUserFromClaims`, add `roles: realmRoles(claims)` to the returned object. Existing provisioning flow (insert-or-fetch) then carries roles on every KeycloakUser return path (fresh create AND existing fetch — the fetch path reads the same claims, so both return `roles`).

- [ ] **Step 4: Run test to verify it passes**

Run the same focused command. Expected: PASS (existing keycloak tests + 3 new).

- [ ] **Step 5: Full suite + commit**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run` — green (any test constructing a `KeycloakUser` literal must set `roles` — fix if the suite surfaces a type error).
```bash
git add portal/src/lib/auth/keycloak.ts portal/src/lib/auth/keycloak.test.ts
git commit -m "feat(portal): parse Keycloak realm roles into KeycloakUser.roles"
```

---

## Task 2: Staff resolution + ctx overlay

**Files:**
- Modify: `portal/src/lib/tenant.ts`
- Modify: `portal/src/lib/tenant.test.ts`
- Modify: `portal/.env.example`

**Interfaces:**
- Consumes: Task 1 `KeycloakUser.roles`, `realmRoles`; existing `tenantContextFromRequest` (tenant.ts:91-118) and `resolveTenantContext`; `getAppMode`.
- Produces (used by Task 3/4):
  - `export function resolvesAsStaff(roles: string[]): boolean` — true iff roles include `STAFF_ROLE` (lowercased compare, env default `"asv-staff"`).
  - `export function staffUserIdOverride(): string[]` — parses `STAFF_USER_IDS` (comma-separated, trimmed, lowercased) → `[]` when unset. Honored only when `getAppMode() !== "prod"`.
  - `tenantContextFromRequest` overlays `isStaff` on the resolved ctx before the session-registry block: prod → `resolvesAsStaff(keycloakUser.roles)`; dev/test → `resolvesAsStaff(roles) || overrideMatch(keycloakUser)` where overrideMatch checks idpId or email against `staffUserIdOverride()`.

- [ ] **Step 1: Write the failing tests**

Extend `portal/src/lib/tenant.test.ts` (read it — real-DB, org/user seeding, but `tenantContextFromRequest` path is mockable via the existing mocks or by passing a request with a real session header; check how it currently exercises the request path — if it doesn't, use the jose-mocked route-test pattern):
```ts
describe("staff identity resolution", () => {
  it("resolvesAsStaff honors STAFF_ROLE (default asv-staff, case-insensitive)", async () => {
    const { resolvesAsStaff } = await import("@/lib/tenant");
    vi.stubEnv("STAFF_ROLE", "");
    try {
      expect(resolvesAsStaff(["asv-staff"])).toBe(true);
      expect(resolvesAsStaff(["ASV-STAFF"])).toBe(true);
      expect(resolvesAsStaff(["scan_operator"])).toBe(false);
      expect(resolvesAsStaff([])).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });

  it("staffUserIdOverride parses comma-separated ids/emails only in dev/test", async () => {
    const { staffUserIdOverride } = await import("@/lib/tenant");
    vi.stubEnv("STAFF_USER_IDS", "kc-qa-1, qa@x.com , ");
    try {
      expect(staffUserIdOverride()).toEqual(["kc-qa-1", "qa@x.com"]);
    } finally { vi.unstubAllEnvs(); }
    expect(staffUserIdOverride()).toEqual([]); // unset → empty
  });
});
```
And a `tenantContextFromRequest` overlay test: mock `provisionKeycloakUser`'s upstream (jose `jwtVerify`) to return claims with `realm_access: { roles: ["asv-staff"] }` + a real seeded org/membership for the user, then assert the returned ctx has `isStaff: true`; and a non-staff claims variant → `false`. (Follow how `keycloak.test.ts` mocks jose; reuse the tenant.test.ts seeded user.)

> Note: `resolveTenantContext` keeps `isStaff: false` hardcoded — the OVERLAY is the only place isStaff becomes true. The service-level harnesses (Phases 3-5) that build `TenantContext` literals are unaffected.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/tenant.test.ts`
Expected: FAIL — `resolvesAsStaff`/`staffUserIdOverride` undefined; overlay absent.

- [ ] **Step 3: Implement**

In `portal/src/lib/tenant.ts` (add near `getAppMode`):
```ts
const DEFAULT_STAFF_ROLE = "asv-staff";

/** True when the verified realm roles include the configured staff role. */
export function resolvesAsStaff(roles: string[]): boolean {
  const wanted = (process.env.STAFF_ROLE || DEFAULT_STAFF_ROLE).toLowerCase();
  return roles.includes(wanted);
}

/** dev/test-only staff override: comma-separated idpIds or emails. */
export function staffUserIdOverride(): string[] {
  const raw = process.env.STAFF_USER_IDS;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
```
In `tenantContextFromRequest`, after `ctx = await resolveTenantContext(user.id)` succeeds (before/inside the session-registry block), add:
```ts
// Staff identity: prod requires the verified realm role claim; dev/test
// additionally honors the STAFF_USER_IDS override. Both gates (report
// attestation, dispute moderation) read ctx.isStaff — this overlay is the
// single place staff is granted.
const staff =
  getAppMode() === "prod"
    ? resolvesAsStaff(keycloakUser.roles)
    : resolvesAsStaff(keycloakUser.roles) ||
      staffUserIdOverride().includes(
        keycloakUser.idpId.toLowerCase()
      ) ||
      staffUserIdOverride().includes(keycloakUser.email.toLowerCase());
if (staff) ctx = { ...ctx, isStaff: true };
```
`getAppMode` is already imported/defined in tenant.ts. Verify `keycloakUser.email` is always a string (it is — `getUserFromClaims` throws without it).

In `portal/.env.example`, add:
```
# --- Staff identity (prod report attestation / dispute moderation) ---
# In prod, staff = verified Keycloak realm role named by STAFF_ROLE.
# In dev/test only, STAFF_USER_IDS (comma-separated idpIds or emails) also grants staff.
STAFF_ROLE="asv-staff"
STAFF_USER_IDS=""
```

- [ ] **Step 4: Run test to verify it passes**

Run the focused command. Expected: PASS (tenant tests + new).

- [ ] **Step 5: Full suite + commit**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run` — green (335 + new).
```bash
git add portal/src/lib/tenant.ts portal/src/lib/tenant.test.ts portal/.env.example
git commit -m "feat(portal): staff identity — realm-role claim (prod) with dev/test STAFF_USER_IDS override"
```

---

## Task 3: Route-level staff proof (attest in prod)

**Files:**
- Modify: `portal/src/app/api/v1/reports/[reportId]/attest/route.test.ts` (or its parent report route test — read which exists first)
- Consumes: Task 2 overlay; the existing `attestReport` prod staff gate (exact message `attestation requires a staff reviewer in prod`).

**Deliverable:** a mocked route test proving that under `APP_MODE=prod`, a request whose mocked Keycloak claims include `realm_access.roles: ["asv-staff"]` reaches the attest route's 200 path (request ctx `isStaff: true`), and a non-staff claim still rejects (409 ReportGuardError / the gate message). Follow the existing report route test's mock shape (`vi.mock("jose")`, `setup(role, ...)` helper); add `realm_access` to the staff-variant mocked claims.

- [ ] **Step 1:** Write the failing tests (staff claim → attest success under prod stub; non-staff claim → the gate rejects). Expect FAIL first (no isStaff from claims yet — the mock claims lack realm_access handling).
- [ ] **Step 2:** Run focused test to confirm RED.
- [ ] **Step 3:** Implement — no production code change should be needed (Task 2's overlay makes the mocked claims flow through; if the route test can't reach the overlay because it mocks `tenantContextFromRequest` directly, adjust the test to mock `jose` instead so the real overlay runs — the test must exercise the REAL `tenantContextFromRequest` path). If the real code needs a tweak, document it.
- [ ] **Step 4:** Focused test green.
- [ ] **Step 5:** Full suite green + commit:
```bash
git add portal/src/app/api/v1/reports portal/src/lib/tenant.ts portal/src/lib/tenant.test.ts
git commit -m "test(portal): route-level proof — staff realm claim reaches prod attestation"
```

---

## Task 4: Exit criteria + handoff

**Files:**
- Modify: `portal/src/lib/scan/exit.test.ts` (staff-claim end-to-end attest + dispute)
- Modify: `AGENTS.md`

**Exit proof (real request-path, not literal ctx):** in a test that drives `tenantContextFromRequest` with a staff-role claim (mocked jose), under `APP_MODE=prod`:
1. A report over an approved scope version can be attested → `status === "attested"`.
2. `moderateDispute` under prod with the staff claim resolves a dispute.
3. A non-staff claim in prod still 409s both gates (unchanged fail-closed).
The existing exit tests use `staffA = { ...ctxA, isStaff: true }` literals (kept — they prove the gate logic); Task 4 ADDS the claim-through-request path so the identity plumbing itself is exit-proven.

`AGENTS.md`: replace the runnability row `❌ Prod staff attestation ...` with a `✅` row + add a `- **Phase 6 DONE** (...)` bullet after Phase 5 (realm-role claim → isStaff; dev/test STAFF_USER_IDS override; prod attest + dispute reachable). Update portal test count with the ACTUAL full-suite result. Then full suite twice (parallel-flake check) + commit:
```bash
git add portal/src/lib/scan/exit.test.ts portal/src/lib/auth/keycloak.test.ts portal/src/lib/tenant.test.ts AGENTS.md
git commit -m "test(portal): Phase 6 exit criteria — staff realm claim reaches prod attestation + moderation; docs: handoff"
```

---

## Self-Review

**Spec coverage:** §5 step-9/10 QA attestation + dispute moderation now reachable in prod → Tasks 2/3/4 (identity plumbing into the existing gates). §2 auth → Task 1 (claim parsing). No DB/migration (no RLS impact). The two prod gates keep their exact fail-closed messages for non-staff — a reviewer must confirm Task 3/4 didn't nudge them.

**Placeholder scan:** every task carries exact code/commands; no TBD. Task 3's "no production code change should be needed" is the expected outcome, but the step explicitly allows documenting a tweak if the test exercises the real overlay — that is a conditional, not a placeholder.

**Type consistency:** `KeycloakUser { idpId, email, roles: string[] }` (Task 1) consumed by `tenantContextFromRequest` overlay (Task 2) and routes (Task 3). `realmRoles(claims)` → `string[]` (Task 1) → `resolvesAsStaff(roles)` (Task 2). `STAFF_ROLE`/`STAFF_USER_IDS` env names consistent across Tasks 2/4 and `.env.example`.

**Handoff note:** Phase 6 closes the "prod report FINAL" runnability blocker. Next candidates: Phase 5b CVE source (Greenbone adapter via CVESource — user installs Greenbone), legacy scanner-DB reconciliation, or Keycloak-first real-login deployment (currently header-token demo auth).