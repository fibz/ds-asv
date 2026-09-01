# Phase 4: Versioned Scope & Authorization + Dispute Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the scope-approval gate and the dispute flow on the control plane so that (a) no scan runs until a merchant has approved an immutable, hashed scope version that is bound by a signed customer `Authorization` (statement hash + scope-version hash), and (b) a customer can raise a dispute on a finding with justification that a QA reviewer moderates — per design spec §4 models and §5.5/step-10 flow.

**Architecture:** The design spec models the gate as documentation-signed state, not loose human sign-off: `ScopeSet` → `ScopeVersion` (immutable once approved; carries a `contentHash` over its items) → `ScopeItem` (snapshot of an asset in scope); `Authorization` records the signed customer authority (`statementHash` = hash of a fixed merchant statement, `scopeVersionHash` = the approved version's content hash, bound by an HMAC signature). The gate enforces "no scan without an approved scope version" in `createScanFromAssets` (prod; dev/test relax per APP_MODE §6 — RLS always on). Disputes: a customer raises a dispute on a finding with justification; a QA reviewer moderates (resolved / rejected) with a note; everything audit-traced. CIDRs in scope remain boundaries only — never expanded into individual-IP profiles.

**Tech Stack:** Next.js 16 + TypeScript, Prisma 7 + PostgreSQL (RLS), `node:crypto` (sha256 + HMAC-SHA256), Tailwind v4, vitest. Same service-layer + route conventions as Phases 2/3.

**Spec:** `docs/superpowers/specs/2026-08-29-ds-asv-pci-portal-design.md` (§4 models: ScopeSet/ScopeVersion/ScopeItem, Authorization, Dispute; §5 flow steps 4-5 scope-approval gate, step 10 dispute flow).

## Global Constraints

- **PostgreSQL RLS on every tenant table.** Every new table carries `organizationId`; RLS enabled + tenant-isolation policy (`"organizationId" = current_setting('app.tenant_id', true)` on USING and WITH CHECK) + `GRANT SELECT, INSERT, UPDATE ON ... TO asv_app` in the SAME migration. **No DELETE grants** (tenant history preserved).
- **Every migration must preserve `Asset_active_unique`** (`("organizationId","type","canonicalIdentifier") WHERE "lifecycleState" <> 'retired'`) — Prisma `migrate diff` may drop it as drift; re-append if missing.
- **Prisma 7 workflow:** never `migrate dev`. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > /tmp/m.sql`, copy to `<timestamp>_<name>/migration.sql`, append RLS/grants, `migrate deploy`, `prisma generate`.
- **Scope gate (§5.5):** no scan runs until a merchant has approved a scope version. In prod (`getAppMode() === "prod"`) `createScanFromAssets` must reject any selected asset that is not a `ScopeItem` of an approved `ScopeVersion` in the org. Dev/test relax the gate but RLS stays on.
- **Immutable approved versions:** once a `ScopeVersion` transitions to `approved`, its `items` and `contentHash` are frozen — service code must never update/delete items of an approved version (no update/delete exposed for them; DB has no DELETE grant anyway).
- **Authorization is documentation-signed:** `statementHash` = sha256 hex of a fixed merchant statement string; `scopeVersionHash` = the approved ScopeVersion's `contentHash`; an HMAC-SHA256 `signature` binds `{organizationId, scopeVersionId, statementHash, scopeVersionHash}`. Secret from `MANIFEST_SECRET` env (reuse — it is the repo's existing cross-service signing secret), dev fallback `"dev-manifest-secret"`, fail-closed in prod when unset (same pattern as `manifest_secret`). Never log a full signature.
- **Content hash:** `sha256` hex over the canonical serialization of the version's items — sorted by `canonicalIdentifier`, each item as the string `type:canonicalIdentifier`, joined with `\n` and prefixed with the item count. Deterministic regardless of creation order.
- **RBAC gates (new/used):** `scope.approve` (owner/security_admin — already in rbac.ts), `scope.manage` (owner/security_admin — create scope sets + versions + submit), `scope.view` (owner/security_admin/asset_manager/scan_operator — NEW), `authorization.issue` (owner/security_admin — NEW), `finding.dispute` (owner/security_admin/asset_manager/scan_operator/report_viewer — NEW, anyone who can see findings), `dispute.moderate` (owner/security_admin — NEW). Add all new ones to `rbac.ts` + tests. `report.view` roles may raise disputes; only owner/security_admin (or staff in prod) moderate.
- **Audit actions:** `scope.set.created`, `scope.version.created`, `scope.version.submitted`, `scope.version.approved`, `authorization.issued`, `finding.dispute.raised`, `finding.dispute.moderated` — all via `recordAudit`, inside the same transaction.
- **Guard errors → 409 in routes.** New `ScopeGuardError` and `DisputeGuardError` must be added to `routeErrorResponse` in `portal/src/lib/http-error.ts` (alongside the existing `ScanGuardError`/`ReportGuardError` branches), per conventions (guard error → 409).
- **App connects as `asv_app`** (RLS always ON); admin/test seeding via `pg.Client` from `ADMIN_DATABASE_URL` with scoped wipes by fixed ids only (never global DELETE — parallel vitest workers share one DB).
- **`set_config('app.tenant_id', ...)` is transaction-scoped** — bind inside `prisma.$transaction` with the tx client (`withTenant` helper).
- **Fixed test ids are unique repo-wide** (org_scope_0001 / org_scope_0002 / user_scope_0001 / etc.).
- **TDD throughout** — failing test first, then implementation, full suite green, commit per task.
- Baseline: portal 283/283 green (`npx vitest run` in `portal/`). Scanner untouched by Phase 4.

---

## File Structure

```
portal/
├── prisma/schema.prisma                        # MODIFY (Task 1): +5 models
├── prisma/migrations/<ts>_phase4_scope/auth    # NEW (Task 1)
├── src/lib/scope/service.ts                    # NEW (Task 2): scope CRUD + versions + hashing + gate helper
├── src/lib/scope/service.test.ts               # NEW (Task 2)
├── src/lib/scope/authorization.ts              # NEW (Task 3): issue/verify signed Authorization
├── src/lib/scope/authorization.test.ts         # NEW (Task 3)
├── src/lib/scan/service.ts                     # MODIFY (Task 4): prod scope gate in createScanFromAssets
├── src/lib/scan/service.test.ts                # MODIFY (Task 4): gate tests
├── src/lib/auth/rbac.ts                        # MODIFY (Tasks 2/6): new actions
├── src/lib/auth/rbac.test.ts                   # MODIFY (Tasks 2/6)
├── src/lib/http-error.ts                       # MODIFY (Tasks 2/6): ScopeGuardError/DisputeGuardError → 409
├── src/lib/disputes/service.ts                 # NEW (Task 6): raise/moderate disputes
├── src/lib/disputes/service.test.ts            # NEW (Task 6)
├── src/app/api/v1/scope-sets/route.ts          # NEW (Task 5)
├── src/app/api/v1/scope-sets/[scopeSetId]/versions/route.ts   # NEW (Task 5)
├── src/app/api/v1/scope-versions/[versionId]/submit/route.ts  # NEW (Task 5)
├── src/app/api/v1/scope-versions/[versionId]/approve/route.ts # NEW (Task 5)
├── src/app/api/v1/scope-versions/[versionId]/authorization/route.ts # NEW (Task 5)
├── src/app/api/v1/findings/[findingId]/disputes/route.ts      # NEW (Task 6)
├── src/app/api/v1/disputes/[disputeId]/moderate/route.ts      # NEW (Task 6)
├── spec/openapi.yaml                          # MODIFY (Tasks 5/6)
├── src/lib/openapi/contract.test.ts           # MODIFY (Tasks 5/6)
├── src/lib/scan/exit.test.ts                  # MODIFY (Task 7): extend spec↔route walk
├── src/lib/scope/exit.test.ts                 # NEW (Task 7): Phase 4 exit criteria
└── AGENTS.md                                  # MODIFY (Task 7)
```

---

## Task 1: Scope/Authorization/Dispute models + RLS migration

**Files:**
- Modify: `portal/prisma/schema.prisma`
- Create: `portal/prisma/migrations/<timestamp>_phase4_scope_auth_dispute/migration.sql`
- Test: `portal/src/lib/scope/scope-rls.test.ts`

**Interfaces:**
- Consumes: existing `Organization`, `Asset`, `Finding` models; the Prisma 7 migration workflow.
- Produces (models + fields used by Tasks 2-6):
  - `ScopeSet`: `id`, `organizationId`, `name`, `description?`, `createdAt/updatedAt`; relation `versions ScopeVersion[]`.
  - `ScopeVersion`: `id`, `scopeSetId`, `organizationId`, `versionNumber Int`, `status` (draft|submitted|approved, default draft), `contentHash String?`, `submittedById?`, `submittedAt?`, `approvedById?`, `approvedAt?`, `createdAt/updatedAt`; relations `scopeSet`, `items ScopeItem[]`, `authorization Authorization?`; `@@unique([scopeSetId, versionNumber])`.
  - `ScopeItem`: `id`, `scopeVersionId`, `organizationId`, `assetId?` (plain String, no FK — assets may be retired later but the snapshot must persist), `type`, `canonicalIdentifier`, `createdAt`; `@@index([scopeVersionId])`, `@@index([organizationId])`.
  - `Authorization`: `id`, `organizationId`, `scopeVersionId String @unique`, `statementHash`, `scopeVersionHash`, `signature`, `status` (issued|revoked, default issued), `issuedById?`, `issuedAt` (default now), `createdAt`; `@@index([organizationId])`.
  - `Dispute`: `id`, `findingId`, `organizationId`, `status` (open|resolved|rejected, default open), `justification`, `resolutionNote?`, `raisedById`, `raisedAt` (default now), `moderatedById?`, `moderatedAt?`, `createdAt/updatedAt`; `@@index([findingId])`, `@@index([organizationId])`.
  - `Finding` gains `disputes Dispute[]`.
  - `Organization` gains `scopeSets ScopeSet[]`, `scopeVersions ScopeVersion[]`, `scopeItems ScopeItem[]`, `authorizations Authorization[]`, `disputes Dispute[]`.

- [ ] **Step 1: Write the failing RLS test**

Create `portal/src/lib/scope/scope-rls.test.ts` (follow the exact harness pattern of `portal/src/lib/scan/scan-rls.test.ts` — read it first; it uses `pg.Client` from `ADMIN_DATABASE_URL`, `withTenant`/`setRlsContext` inside `$transaction`, scoped admin wipes by fixed ids):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ADMIN_URL = process.env.ADMIN_DATABASE_URL!;
const ORG = "org_scope_rls_0001";
const USER = "user_scope_rls_0001";

async function withTenant<T>(orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => { await setRlsContext(orgId, tx); return fn(tx); });
}

async function adminWipe() {
  const pg = new Client({ connectionString: ADMIN_URL });
  await pg.connect();
  try {
    await pg.query(`DELETE FROM "Dispute" WHERE "organizationId" LIKE 'org_scope_rls_%'`);
    await pg.query(`DELETE FROM "Authorization" WHERE "organizationId" LIKE 'org_scope_rls_%'`);
    await pg.query(`DELETE FROM "ScopeItem" WHERE "organizationId" LIKE 'org_scope_rls_%'`);
    await pg.query(`DELETE FROM "ScopeVersion" WHERE "organizationId" LIKE 'org_scope_rls_%'`);
    await pg.query(`DELETE FROM "ScopeSet" WHERE "organizationId" LIKE 'org_scope_rls_%'`);
    await pg.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await pg.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally {
    await pg.end();
  }
}

beforeAll(async () => {
  await adminWipe();
  const pg = new Client({ connectionString: ADMIN_URL });
  await pg.connect();
  try {
    await pg.query(`INSERT INTO "Organization" (id, name) VALUES ($1, $2)`, [ORG, "Scope RLS Org"]);
    await pg.query(`INSERT INTO "User" (id, "idpId", email) VALUES ($1, $2, $3)`, [USER, "kc-scope-rls-1", "a@x.com"]);
  } finally {
    await pg.end();
  }
});

afterAll(async () => {
  await adminWipe();
  await prisma.$disconnect();
});

describe("scope domain RLS", () => {
  it("rejects inserts without tenant context", async () => {
    await expect(
      prisma.scopeSet.create({ data: { organizationId: ORG, name: "x" } })
    ).rejects.toThrowError(/violates row-level security policy|42501/i);
  });

  it("inserts and reads all five tables under tenant context", async () => {
    const set = await withTenant(ORG, (tx) =>
      tx.scopeSet.create({ data: { organizationId: ORG, name: "PCI Scope" } })
    );
    const version = await withTenant(ORG, (tx) =>
      tx.scopeVersion.create({
        data: { scopeSetId: set.id, organizationId: ORG, versionNumber: 1, status: "draft" },
      })
    );
    await withTenant(ORG, (tx) =>
      tx.scopeItem.create({
        data: { scopeVersionId: version.id, organizationId: ORG, assetId: "a1", type: "ipv4", canonicalIdentifier: "10.1.1.1" },
      })
    );
    await withTenant(ORG, (tx) =>
      tx.authorization.create({
        data: {
          organizationId: ORG,
          scopeVersionId: version.id,
          statementHash: "h1",
          scopeVersionHash: "h2",
          signature: "sig",
        },
      })
    );
    await withTenant(ORG, (tx) =>
      tx.dispute.create({
        data: { findingId: "f1", organizationId: ORG, justification: "not our host" },
      })
    );
    const sets = await withTenant(ORG, (tx) => tx.scopeSet.findMany({}));
    expect(sets.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects DELETE on ScopeSet (no grant)", async () => {
    const set = await withTenant(ORG, (tx) =>
      tx.scopeSet.create({ data: { organizationId: ORG, name: "Del" } })
    );
    await expect(withTenant(ORG, (tx) => tx.scopeSet.delete({ where: { id: set.id } }))).rejects.toThrow(
      /permission denied|42501/i
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scope/scope-rls.test.ts`
Expected: FAIL — `Cannot find module '@/lib/scope/scope-rls'` isn't the issue; the creation fails because the models don't exist yet (`prisma.scopeSet` is undefined) and the migration isn't applied.

- [ ] **Step 3: Add the models to schema.prisma**

Add to `portal/prisma/schema.prisma` (exact blocks; place near the scan-domain models):
```prisma
model ScopeSet {
  id             String         @id @default(cuid())
  organizationId String
  name           String
  description    String?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  organization   Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  versions       ScopeVersion[]

  @@index([organizationId])
}

model ScopeVersion {
  id             String         @id @default(cuid())
  scopeSetId     String
  organizationId String
  versionNumber  Int
  status         String         @default("draft") // draft, submitted, approved
  contentHash    String?
  submittedById  String?
  submittedAt    DateTime?
  approvedById   String?
  approvedAt     DateTime?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  scopeSet       ScopeSet       @relation(fields: [scopeSetId], references: [id], onDelete: Cascade)
  organization   Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  items          ScopeItem[]
  authorization  Authorization?

  @@unique([scopeSetId, versionNumber])
  @@index([organizationId])
}

model ScopeItem {
  id                 String      @id @default(cuid())
  scopeVersionId     String
  organizationId     String
  assetId            String?
  type               String      // ipv4 | ipv6 | cidr | fqdn
  canonicalIdentifier String
  createdAt          DateTime    @default(now())
  scopeVersion       ScopeVersion @relation(fields: [scopeVersionId], references: [id], onDelete: Cascade)
  organization       Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([scopeVersionId])
  @@index([organizationId])
}

model Authorization {
  id               String       @id @default(cuid())
  organizationId   String
  scopeVersionId   String       @unique
  statementHash    String
  scopeVersionHash String
  signature        String
  status           String       @default("issued") // issued, revoked
  issuedById       String?
  issuedAt         DateTime     @default(now())
  createdAt        DateTime     @default(now())
  scopeVersion     ScopeVersion @relation(fields: [scopeVersionId], references: [id], onDelete: Cascade)
  organization     Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
}

model Dispute {
  id               String      @id @default(cuid())
  findingId        String
  organizationId   String
  status           String      @default("open") // open, resolved, rejected
  justification    String
  resolutionNote   String?
  raisedById       String
  raisedAt         DateTime    @default(now())
  moderatedById    String?
  moderatedAt      DateTime?
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
  finding          Finding     @relation(fields: [findingId], references: [id], onDelete: Cascade)
  organization     Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([findingId])
  @@index([organizationId])
}
```
Add `disputes Dispute[]` to the `Finding` model. Add to `Organization` (near the existing relation arrays):
```prisma
  scopeSets           ScopeSet[]
  scopeVersions       ScopeVersion[]
  scopeItems          ScopeItem[]
  authorizations      Authorization[]
  disputes            Dispute[]
```

- [ ] **Step 4: Generate + finalize the migration**

```bash
cd portal
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > /tmp/p4.sql
mkdir -p prisma/migrations/<timestamp>_phase4_scope_auth_dispute
cp /tmp/p4.sql prisma/migrations/<timestamp>_phase4_scope_auth_dispute/migration.sql
```
- Confirm the diff creates the five tables with FKs + `@@unique([scopeSetId, versionNumber])` + `Authorization.scopeVersionId` unique + indexes.
- **Verify `Asset_active_unique` survived** (grep the generated SQL; if missing, re-append the `CREATE UNIQUE INDEX "Asset_active_unique" ...` line from migration `20260830000002_phase2_assets`).
- Append the RLS block to the same migration file:
```sql
-- Phase 4: scope/authorization/dispute RLS (fail-closed pattern).
ALTER TABLE "ScopeSet" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope_set_tenant_isolation ON "ScopeSet"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));
ALTER TABLE "ScopeVersion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope_version_tenant_isolation ON "ScopeVersion"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));
ALTER TABLE "ScopeItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope_item_tenant_isolation ON "ScopeItem"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));
ALTER TABLE "Authorization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY authorization_tenant_isolation ON "Authorization"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));
ALTER TABLE "Dispute" ENABLE ROW LEVEL SECURITY;
CREATE POLICY dispute_tenant_isolation ON "Dispute"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON "ScopeSet" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "ScopeVersion" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "ScopeItem" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "Authorization" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "Dispute" TO asv_app;
```
Deploy + regenerate:
```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scope/scope-rls.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run full suite + commit**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run`
Expected: green (283 baseline + 3 new).

```bash
git add portal/prisma/schema.prisma portal/prisma/migrations/<timestamp>_phase4_scope_auth_dispute/migration.sql portal/src/lib/scope/scope-rls.test.ts
git commit -m "feat(portal): scope/auth/dispute models (ScopeSet/Version/Item, Authorization, Dispute) + RLS"
```

---

## Task 2: Scope service (create/snapshot/submit/approve + gate helper)

**Files:**
- Create: `portal/src/lib/scope/service.ts`
- Test: `portal/src/lib/scope/service.test.ts`
- Modify: `portal/src/lib/auth/rbac.ts` (add `scope.manage`, `scope.view`), `portal/src/lib/auth/rbac.test.ts`
- Modify: `portal/src/lib/http-error.ts` (map `ScopeGuardError` → 409)

**Interfaces:**
- Consumes: Task 1 models (`ScopeSet`/`ScopeVersion`/`ScopeItem`), `setRlsContext`/`TenantContext`/`getAppMode` from `@/lib/tenant`, `recordAudit` from `@/lib/audit`, `prisma` from `@/lib/prisma-client`.
- Produces (used by Tasks 3/4/5/7):
  - `export class ScopeGuardError extends Error {}`
  - `export function scopeContentHash(items: { type: string; canonicalIdentifier: string }[]): string` — `sha256` hex over `items.length + "\n" + items.map(i => `${i.type}:${i.canonicalIdentifier}`).sort().join("\n")`.
  - `export async function createScopeSet(ctx, input: { name: string; description?: string }): Promise<ScopeSet>`
  - `export async function createScopeVersion(ctx, scopeSetId: string, input: { assetIds: string[] }): Promise<ScopeVersion & { items: ... }>` — snapshot assets into ScopeItems (org-scoped, skip retired), versionNumber = max+1, status draft, contentHash computed over the snapshot.
  - `export async function submitScopeVersion(ctx, versionId: string): Promise<ScopeVersion | null>` — draft→submitted (guard `only draft scope versions can be submitted`), sets submittedById/At.
  - `export async function approveScopeVersion(ctx, versionId: string): Promise<ScopeVersion | null>` — submitted→approved (guard `only submitted scope versions can be approved`), sets approvedById/At + frozen contentHash.
  - `export async function listScopeSets(ctx): Promise<ScopeSet[]>`
  - `export async function getScopeVersion(ctx, versionId: string): Promise<(ScopeVersion & { items: ScopeItem[] }) | null>`
  - `export async function assetInApprovedScope(ctx, assetId: string): Promise<boolean>` — true iff there is an approved ScopeVersion containing a ScopeItem with `assetId` in the org (used by the Task 4 gate).

- [ ] **Step 1: Add RBAC + guard-error mappings first**

In `portal/src/lib/auth/rbac.ts`, after the `scope.approve` line, add:
```ts
if (action === "scope.manage") return hasRole(user, "organization_owner", "security_admin");
if (action === "scope.view") return hasRole(user, "organization_owner", "security_admin", "asset_manager", "scan_operator");
```
In `portal/src/lib/auth/rbac.test.ts`, add assertions (owner/security_admin can scope.manage + scope.view; asset_manager can scope.view but not scope.manage; report_viewer can neither).

In `portal/src/lib/http-error.ts`, import `ScopeGuardError` from `@/lib/scope/service` and add an `instanceof ScopeGuardError` branch → 409 (alongside ScanGuardError/ReportGuardError).

- [ ] **Step 2: Write the failing service test**

Create `portal/src/lib/scope/service.test.ts` (real-DB harness matching `portal/src/lib/scan/service.test.ts` patterns — scoped admin wipes by fixed ids, `withTenant`, fixed unique ids `org_scope_svc_0001`/`org_scope_svc_0002`/`user_scope_svc_0001`, assets `asset_scope_1`/`asset_scope_2` with lifecycleState active, verificationState verified; seed via the same admin pg + withTenant pattern; use `pg.Client` from `ADMIN_DATABASE_URL`):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext, resolveTenantContext } from "@/lib/tenant";
import {
  ScopeGuardError,
  approveScopeVersion,
  assetInApprovedScope,
  createScopeSet,
  createScopeVersion,
  getScopeVersion,
  scopeContentHash,
  submitScopeVersion,
} from "./service";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_scope_svc_0001";
const ORG2 = "org_scope_svc_0002";
const USER = "user_scope_svc_0001";
const USER2 = "user_scope_svc_0002";

let ctxA: any;
let ctxB: any;

async function withTenant<T>(orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => { await setRlsContext(orgId, tx); return fn(tx); });
}

async function seed() {
  const pg = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await pg.connect();
  try {
    for (const id of [ORG, ORG2]) await pg.query(`DELETE FROM "Organization" WHERE id = $1`, [id]);
    for (const id of [USER, USER2]) await pg.query(`DELETE FROM "User" WHERE id = $1`, [id]);
    await pg.query(`INSERT INTO "Organization" (id, name) VALUES ($1,$2)`, [ORG, "Scope A"]);
    await pg.query(`INSERT INTO "Organization" (id, name) VALUES ($1,$2)`, [ORG2, "Scope B"]);
    await pg.query(`INSERT INTO "User" (id,"idpId",email) VALUES ($1,$2,$3)`, [USER, "kc-scope-svc-1", "a@x.com"]);
    await pg.query(`INSERT INTO "User" (id,"idpId",email) VALUES ($1,$2,$3)`, [USER2, "kc-scope-svc-2", "b@x.com"]);
    await pg.query(`INSERT INTO "OrganizationMembership" (id,"organizationId","userId",role,status) VALUES ($1,$2,$3,$4,'active')`, ["om_scope_svc_1", ORG, USER, "organization_owner"]);
    await pg.query(`INSERT INTO "OrganizationMembership" (id,"organizationId","userId",role,status) VALUES ($1,$2,$3,$4,'active')`, ["om_scope_svc_2", ORG2, USER2, "organization_owner"]);
    for (const a of [
      { id: "asset_scope_1", org: ORG, type: "ipv4", ci: "10.1.1.1" },
      { id: "asset_scope_2", org: ORG, type: "ipv4", ci: "10.1.1.2" },
    ]) {
      await pg.query(
        `INSERT INTO "Asset" (id,"organizationId",type,"canonicalIdentifier","lifecycleState","verificationState") VALUES ($1,$2,$3,$4,'active','verified')`,
        [a.id, a.org, a.type, a.ci]
      );
    }
  } finally {
    await pg.end();
  }
}

async function wipe() {
  const pg = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await pg.connect();
  try {
    await pg.query(`DELETE FROM "Authorization" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "ScopeItem" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "ScopeVersion" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "ScopeSet" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "Asset" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "OrganizationMembership" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "AuditEvent" WHERE "organizationId" LIKE 'org_scope_svc_%'`);
    await pg.query(`DELETE FROM "Organization" WHERE id IN ($1,$2)`, [ORG, ORG2]);
    await pg.query(`DELETE FROM "User" WHERE id IN ($1,$2)`, [USER, USER2]);
  } finally {
    await pg.end();
  }
}

beforeAll(async () => {
  await wipe();
  await seed();
  ctxA = await resolveTenantContext(USER);
  ctxB = await resolveTenantContext(USER2);
});

afterAll(async () => { await wipe(); await prisma.$disconnect(); });

describe("scope service", () => {
  it("content hash is deterministic and order-independent", () => {
    const items = [{ type: "ipv4", canonicalIdentifier: "10.1.1.1" }, { type: "ipv4", canonicalIdentifier: "10.1.1.2" }];
    const reversed = [...items].reverse();
    expect(scopeContentHash(items)).toBe(scopeContentHash(reversed));
    expect(scopeContentHash(items).length).toBe(64);
  });

  it("creates a scope set and a draft version snapshotting assets", async () => {
    const set = await createScopeSet(ctxA, { name: "PCI Scope" });
    const version = await createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_1", "asset_scope_2"] });
    expect(version.status).toBe("draft");
    expect(version.items).toHaveLength(2);
    expect(version.contentHash).toBeTruthy();
    // Retired assets are skipped
    await withTenant(ORG, (tx) => tx.asset.update({ where: { id: "asset_scope_2" }, data: { lifecycleState: "retired" } }));
    const v2 = await createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_1", "asset_scope_2"] });
    const ids = v2.items.map((i) => i.assetId);
    expect(ids).not.toContain("asset_scope_2");
  });

  it("submits and approves, freezing the version; gates transitions", async () => {
    const set = await createScopeSet(ctxA, { name: "Gate Scope" });
    const version = await createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_1"] });
    const submitted = await submitScopeVersion(ctxA, version.id);
    expect(submitted?.status).toBe("submitted");
    await expect(submitScopeVersion(ctxA, version.id)).rejects.toThrowError(ScopeGuardError);
    const approved = await approveScopeVersion(ctxA, version.id);
    expect(approved?.status).toBe("approved");
    expect(approved?.contentHash).toBe(version.contentHash);
    await expect(approveScopeVersion(ctxA, version.id)).rejects.toThrowError(ScopeGuardError);
    // cross-tenant
    const other = await getScopeVersion(ctxB, version.id);
    expect(other).toBeNull();
  });

  it("assetInApprovedScope reflects approval and tenant", async () => {
    const set = await createScopeSet(ctxA, { name: "Gated" });
    const version = await createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_1"] });
    expect(await assetInApprovedScope(ctxA, "asset_scope_1")).toBe(false);
    await submitScopeVersion(ctxA, version.id);
    await approveScopeVersion(ctxA, version.id);
    expect(await assetInApprovedScope(ctxA, "asset_scope_1")).toBe(true);
    expect(await assetInApprovedScope(ctxB, "asset_scope_1")).toBe(false);
  });
});
```
(Adjust the harness to match the existing test conventions exactly — e.g. membership inserter columns. Verify against `portal/src/lib/scan/service.test.ts`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scope/service.test.ts`
Expected: FAIL — `Cannot find module '@/lib/scope/service'`.

- [ ] **Step 4: Implement the scope service**

Create `portal/src/lib/scope/service.ts`:
```ts
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, ScopeSet, ScopeVersion, ScopeItem } from "@/lib/generated/prisma";

export class ScopeGuardError extends Error {}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

/** Deterministic content hash over a version's items: sorted by canonicalIdentifier. */
export function scopeContentHash(items: { type: string; canonicalIdentifier: string }[]): string {
  const lines = items.map((i) => `${i.type}:${i.canonicalIdentifier}`).sort();
  return createHash("sha256").update(`${items.length}\n${lines.join("\n")}`).digest("hex");
}

export async function createScopeSet(ctx: TenantContext, input: { name: string; description?: string }): Promise<ScopeSet> {
  const name = input.name.trim();
  if (!name || name.length > 200) throw new ScopeGuardError("name must be a non-empty string up to 200 chars");
  return withTenant(ctx.organizationId, async (tx) => {
    const set = await tx.scopeSet.create({ data: { organizationId: ctx.organizationId, name, description: input.description ?? null } });
    await recordAudit(ctx, "scope.set.created", "ScopeSet", set.id, undefined, { name }, undefined, tx);
    return set;
  });
}

export async function createScopeVersion(
  ctx: TenantContext,
  scopeSetId: string,
  input: { assetIds: string[] }
): Promise<ScopeVersion & { items: ScopeItem[] }> {
  if (!Array.isArray(input.assetIds) || input.assetIds.length === 0) {
    throw new ScopeGuardError("assetIds must contain at least one asset");
  }
  return withTenant(ctx.organizationId, async (tx) => {
    const set = await tx.scopeSet.findUnique({ where: { id: scopeSetId } });
    if (!set) throw new ScopeGuardError("Scope set not found");
    const assets = await tx.asset.findMany({ where: { id: { in: input.assetIds }, organizationId: ctx.organizationId } });
    // exact set match (org-scoped) — missing/foreign assets rejected up front
    if (assets.length !== new Set(input.assetIds).size) throw new ScopeGuardError("one or more assets not found in this organization");
    const inScope = assets.filter((a) => a.lifecycleState !== "retired");
    const last = await tx.scopeVersion.findFirst({ where: { scopeSetId }, orderBy: { versionNumber: "desc" } });
    const versionNumber = (last?.versionNumber ?? 0) + 1;
    const items = inScope.map((a) => ({ assetId: a.id, type: a.type, canonicalIdentifier: a.canonicalIdentifier }));
    const contentHash = scopeContentHash(items);
    const version = await tx.scopeVersion.create({
      data: { scopeSetId, organizationId: ctx.organizationId, versionNumber, status: "draft", contentHash },
    });
    for (const it of items) {
      await tx.scopeItem.create({
        data: { scopeVersionId: version.id, organizationId: ctx.organizationId, assetId: it.assetId, type: it.type, canonicalIdentifier: it.canonicalIdentifier },
      });
    }
    await recordAudit(ctx, "scope.version.created", "ScopeVersion", version.id, undefined, { versionNumber, items: inScope.map((a) => a.canonicalIdentifier) }, undefined, tx);
    const created = await tx.scopeVersion.findUnique({ where: { id: version.id }, include: { items: true } });
    return created!;
  });
}

export async function submitScopeVersion(ctx: TenantContext, versionId: string): Promise<ScopeVersion | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const version = await tx.scopeVersion.findUnique({ where: { id: versionId } });
    if (!version) return null;
    if (version.status !== "draft") throw new ScopeGuardError("only draft scope versions can be submitted");
    const updated = await tx.scopeVersion.update({
      where: { id: versionId },
      data: { status: "submitted", submittedById: ctx.userId, submittedAt: new Date() },
    });
    await recordAudit(ctx, "scope.version.submitted", "ScopeVersion", versionId, { status: "draft" }, { status: "submitted" }, undefined, tx);
    return updated;
  });
}

export async function approveScopeVersion(ctx: TenantContext, versionId: string): Promise<ScopeVersion | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const version = await tx.scopeVersion.findUnique({ where: { id: versionId } });
    if (!version) return null;
    if (version.status !== "submitted") throw new ScopeGuardError("only submitted scope versions can be approved");
    const updated = await tx.scopeVersion.update({
      where: { id: versionId },
      data: { status: "approved", approvedById: ctx.userId, approvedAt: new Date() },
    });
    await recordAudit(ctx, "scope.version.approved", "ScopeVersion", versionId, { status: "submitted" }, { status: "approved" }, undefined, tx);
    return updated;
  });
}

export async function listScopeSets(ctx: TenantContext): Promise<ScopeSet[]> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.scopeSet.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, include: { versions: { orderBy: { versionNumber: "desc" } } } })
  );
}

export async function getScopeVersion(ctx: TenantContext, versionId: string): Promise<(ScopeVersion & { items: ScopeItem[] }) | null> {
  return withTenant(ctx.organizationId, (tx) => tx.scopeVersion.findUnique({ where: { id: versionId }, include: { items: true } }));
}

export async function assetInApprovedScope(ctx: TenantContext, assetId: string): Promise<boolean> {
  return withTenant(ctx.organizationId, async (tx) => {
    const found = await tx.scopeItem.findFirst({
      where: { organizationId: ctx.organizationId, assetId, scopeVersion: { status: "approved" } },
    });
    return found !== null;
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scope/service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Full suite + commit**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run` — green.

```bash
git add portal/src/lib/scope/service.ts portal/src/lib/scope/service.test.ts portal/src/lib/auth/rbac.ts portal/src/lib/auth/rbac.test.ts portal/src/lib/http-error.ts
git commit -m "feat(portal): scope service — sets, immutable versioned snapshots, submit/approve, gate helper"
```

---

## Task 3: Authorization service (issue/verify signed authority)

**Files:**
- Create: `portal/src/lib/scope/authorization.ts`
- Test: `portal/src/lib/scope/authorization.test.ts`
- Modify: `portal/src/lib/auth/rbac.ts` (add `authorization.issue`)

**Interfaces:**
- Consumes: Task 2 `getScopeVersion`, Task 1 `Authorization` model, `node:crypto`, `getAppMode`.
- Produces (used by Tasks 5/7):
  - `export function statementHash(statement: string): string` — sha256 hex of a fixed merchant statement string (e.g. `"I authorize ASV scanning of the assets in the approved scope version of my organization."`).
  - `export function authorizationSignature(payload: { organizationId: string; scopeVersionId: string; statementHash: string; scopeVersionHash: string }): string` — HMAC-SHA256 hex over the deep-canonical JSON of the payload (reuse the recursive-sort + compact form; see `portal/src/lib/scan/manifest.ts` `sortKeysDeep`/compact canonical), secret from `MANIFEST_SECRET` env, dev fallback `"dev-manifest-secret"`, fail-closed in prod.
  - `export async function issueAuthorization(ctx, scopeVersionId: string): Promise<Authorization>` — requires the version approved (`ScopeGuardError("authorization requires an approved scope version")`); statementHash + scopeVersionHash = approved version's contentHash; signature = authorizationSignature({...}); upsert (idempotent per scopeVersionId); audit `authorization.issued`; returns the row.
  - `export async function getAuthorization(ctx, scopeVersionId: string): Promise<Authorization | null>` — org-scoped lookup by scopeVersionId.
  - `export function verifyAuthorizationSignature(auth: { organizationId: string; scopeVersionId: string; statementHash: string; scopeVersionHash: string; signature: string }): boolean` — recompute + timing-safe compare.

- [ ] **Step 1: Add RBAC `authorization.issue`**

In `portal/src/lib/auth/rbac.ts` add: `if (action === "authorization.issue") return hasRole(user, "organization_owner", "security_admin");` + a rbac.test assertion.

- [ ] **Step 2: Write the failing authorization test**

Create `portal/src/lib/scope/authorization.test.ts` (real-DB harness like Task 2: org_scope_auth_0001/user_scope_auth_0001/asset_scope_auth_1; owner ctx; seed asset + membership; wipes scoped):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { resolveTenantContext } from "@/lib/tenant";
import { approveScopeVersion, createScopeSet, createScopeVersion, submitScopeVersion } from "./service";
import { authorizationSignature, getAuthorization, issueAuthorization, statementHash, verifyAuthorizationSignature } from "./authorization";
import { ScopeGuardError } from "./service";

const ORG = "org_scope_auth_0001";
const USER = "user_scope_auth_0001";
let ctx: any;

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
    await pg.query(`INSERT INTO "Organization" (id,name) VALUES ($1,$2)`, [ORG, "Auth Org"]);
    await pg.query(`INSERT INTO "User" (id,"idpId",email) VALUES ($1,$2,$3)`, [USER, "kc-scope-auth-1", "a@x.com"]);
    await pg.query(`INSERT INTO "OrganizationMembership" (id,"organizationId","userId",role,status) VALUES ($1,$2,$3,$4,'active')`, ["om_scope_auth_1", ORG, USER, "organization_owner"]);
    await pg.query(`INSERT INTO "Asset" (id,"organizationId",type,"canonicalIdentifier","lifecycleState","verificationState") VALUES ($1,$2,$3,$4,'active','verified')`, ["asset_scope_auth_1", ORG, "ipv4", "10.2.2.2"]);
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
```
(Note: `statementHash("")` compares against the module's fixed statement constant — define `MERCHANT_STATEMENT` and export it, and use it in both the test and `issueAuthorization`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scope/authorization.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the authorization service**

Create `portal/src/lib/scope/authorization.ts`:
```ts
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext, getAppMode } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { getScopeVersion, ScopeGuardError } from "./service";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, Authorization } from "@/lib/generated/prisma";

export const MERCHANT_STATEMENT =
  "I authorize ASV scanning of the assets in the approved scope version of my organization.";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

export function statementHash(statement: string = MERCHANT_STATEMENT): string {
  return createHash("sha256").update(statement).digest("hex");
}

function signatureSecret(): string {
  const secret = process.env.MANIFEST_SECRET;
  if (secret) return secret;
  if (getAppMode() === "prod") throw new Error("MANIFEST_SECRET is required when APP_MODE=prod");
  return "dev-manifest-secret";
}

function deepCanonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sort((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export function authorizationSignature(payload: {
  organizationId: string;
  scopeVersionId: string;
  statementHash: string;
  scopeVersionHash: string;
}): string {
  return createHmac("sha256", signatureSecret())
    .update(deepCanonicalJson(payload))
    .digest("hex");
}

export function verifyAuthorizationSignature(auth: {
  organizationId: string;
  scopeVersionId: string;
  statementHash: string;
  scopeVersionHash: string;
  signature: string;
}): boolean {
  const expected = Buffer.from(
    authorizationSignature({ organizationId: auth.organizationId, scopeVersionId: auth.scopeVersionId, statementHash: auth.statementHash, scopeVersionHash: auth.scopeVersionHash }),
    "hex"
  );
  const actual = Buffer.from(auth.signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function issueAuthorization(ctx: TenantContext, scopeVersionId: string): Promise<Authorization> {
  return withTenant(ctx.organizationId, async (tx) => {
    const version = await getScopeVersion(ctx, scopeVersionId);
    if (!version) throw new ScopeGuardError("Scope version not found");
    if (version.status !== "approved") throw new ScopeGuardError("authorization requires an approved scope version");
    const payload = {
      organizationId: ctx.organizationId,
      scopeVersionId,
      statementHash: statementHash(),
      scopeVersionHash: version.contentHash!,
    };
    const signature = authorizationSignature(payload);
    const existing = await tx.authorization.findUnique({ where: { scopeVersionId } });
    let auth: Authorization;
    if (existing) {
      auth = await tx.authorization.update({
        where: { id: existing.id },
        data: { statementHash: payload.statementHash, scopeVersionHash: payload.scopeVersionHash, signature, status: "issued", issuedById: ctx.userId, issuedAt: new Date() },
      });
    } else {
      auth = await tx.authorization.create({
        data: { organizationId: ctx.organizationId, scopeVersionId, statementHash: payload.statementHash, scopeVersionHash: payload.scopeVersionHash, signature, status: "issued", issuedById: ctx.userId },
      });
    }
    await recordAudit(ctx, "authorization.issued", "Authorization", auth.id, undefined, { scopeVersionId }, undefined, tx);
    return auth;
  });
}

export async function getAuthorization(ctx: TenantContext, scopeVersionId: string): Promise<Authorization | null> {
  return withTenant(ctx.organizationId, (tx) => tx.authorization.findUnique({ where: { scopeVersionId } }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scope/authorization.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Full suite + commit**

```bash
git add portal/src/lib/scope/authorization.ts portal/src/lib/scope/authorization.test.ts portal/src/lib/auth/rbac.ts portal/src/lib/auth/rbac.test.ts
git commit -m "feat(portal): authorization — signed customer authority (statement + scope-version hash)"
```

---

## Task 4: Scope-approval gate in scan creation

**Files:**
- Modify: `portal/src/lib/scan/service.ts` (`createScanFromAssets`)
- Modify: `portal/src/lib/scan/service.test.ts`

**Interfaces:**
- Consumes: Task 2 `assetInApprovedScope`, existing `createScanFromAssets`.
- Produces: the prod gate — `createScanFromAssets` in `getAppMode() === "prod"` rejects any selected asset not in an approved scope version.

- [ ] **Step 1: Write the failing gate test**

Append to `portal/src/lib/scan/service.test.ts` a new describe (reuse its harness/ids; the test file already seeds org_scan_svc_0001 + verified assets; create a scope set/version/approve for one asset only):
```ts
describe("scan creation scope gate (prod)", () => {
  it("rejects unapproved-scope assets in prod, allows approved ones", async () => {
    const { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion } = await import("@/lib/scope/service");
    const set = await createScopeSet(ctx, { name: "Gated" });
    const version = await createScopeVersion(ctx, set.id, { assetIds: ["asset_scan_svc_1"] });
    await submitScopeVersion(ctx, version.id);
    await approveScopeVersion(ctx, version.id);
    // appMode is dev in this suite; force prod via vi.stubEnv
    const { default: vi } = await import("vitest");
    vi.stubEnv("APP_MODE", "prod");
    try {
      // asset_scan_svc_1 approved → ok; asset_scan_svc_2 not in scope → rejected
      await expect(
        createScanFromAssets(ctx, { name: "ok", assetIds: ["asset_scan_svc_1"] })
      ).resolves.toBeTruthy();
      await expect(
        createScanFromAssets(ctx, { name: "bad", assetIds: ["asset_scan_svc_2"] })
      ).rejects.toThrowError(/approved scope version/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
```
(Verify the existing test file's ctx ids — the service.test.ts seeds org_scan_svc_0001 with assets; match its variable names. If the assets are named differently, adjust. If `createScanFromAssets` is called with the gate and appMode is dev, the suite's normal tests stay green because the gate only fires in prod.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/service.test.ts`
Expected: FAIL — the unapproved asset is NOT rejected (gate not implemented).

- [ ] **Step 3: Implement the gate**

In `portal/src/lib/scan/service.ts` `createScanFromAssets`, after the existing prod verification check, add:
```ts
if (prod) {
  for (const a of assets) {
    const inScope = await assetInApprovedScope(ctx, a.id);
    if (!inScope) throw new ScanGuardError(`asset ${a.canonicalIdentifier} is not in an approved scope version (required in prod)`);
  }
}
```
Add `import { assetInApprovedScope } from "@/lib/scope/service";` at the top of service.ts. (Note: `assetInApprovedScope` uses its own `withTenant` transaction — nested transactions are fine in Prisma; the gate is a read, not part of the scan-creation tx. Keep the audit/create in the existing tx.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/service.test.ts`
Expected: PASS (existing 5 + 1 new).

- [ ] **Step 5: Full suite + commit**

```bash
git add portal/src/lib/scan/service.ts portal/src/lib/scan/service.test.ts
git commit -m "feat(portal): prod scope-approval gate on scan creation"
```

---

## Task 5: Scope + authorization API routes + contract

**Files:**
- Create: `portal/src/app/api/v1/scope-sets/route.ts`, `portal/src/app/api/v1/scope-sets/[scopeSetId]/versions/route.ts`, `portal/src/app/api/v1/scope-versions/[versionId]/submit/route.ts`, `portal/src/app/api/v1/scope-versions/[versionId]/approve/route.ts`, `portal/src/app/api/v1/scope-versions/[versionId]/authorization/route.ts`
- Modify: `portal/spec/openapi.yaml`, `portal/src/lib/openapi/contract.test.ts`
- Test: `portal/src/app/api/v1/scope-sets/route.test.ts` (mocked, following the Phase 3 route-test pattern)

**Interfaces:**
- Consumes: Task 2/3 services + rbac + routeErrorResponse.
- Produces:
  - `GET /api/v1/scope-sets` (gate `scope.view`) → `{ scopeSets }`
  - `POST /api/v1/scope-sets` (gate `scope.manage`) body `{name, description?}` → 201 ScopeSet
  - `POST /api/v1/scope-sets/{scopeSetId}/versions` (gate `scope.manage`) body `{assetIds}` → 201 version + items
  - `POST /api/v1/scope-versions/{versionId}/submit` (gate `scope.manage`) → 200
  - `POST /api/v1/scope-versions/{versionId}/approve` (gate `scope.approve`) → 200
  - `POST /api/v1/scope-versions/{versionId}/authorization` (gate `authorization.issue`) → 201 Authorization
  - All routes: 401 no ctx, 403 forbidden, 400 bad body, wrap service errors in `routeErrorResponse` (ScopeGuardError → 409 via Task 2).

- [ ] **Step 1: Write one mocked route test (route.test.ts covers the GET + POST scope-sets pair plus one nested route; the remaining routes follow the same pattern)**

Create `portal/src/app/api/v1/scope-sets/route.test.ts` (mock jose + prisma-client txMock + `@/lib/scope/service`; follow `portal/src/app/api/v1/scans/route.test.ts` and `portal/src/app/api/v1/scans/[scanId]/findings/route.test.ts` exactly — APP_MODE=prod + KEYCLOAK stubs in beforeEach; `setupUser(kcId, role)` helper; `vi.mock("@/lib/scope/service")`):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { GET, POST } from "./route";
import { getScopeVersion, approveScopeVersion } from "@/lib/scope/service";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));
vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});
vi.mock("@/lib/scope/service", () => ({
  listScopeSets: vi.fn(),
  createScopeSet: vi.fn(),
  createScopeVersion: vi.fn(),
  submitScopeVersion: vi.fn(),
  approveScopeVersion: vi.fn(),
  issueAuthorization: vi.fn(),
  getScopeVersion: vi.fn(),
  ScopeGuardError: class extends Error {},
}));

const CLAIMS = { sub: "kc-scope-route", email: "u@x.com" };

async function setupUser(role: string, mock: any) {
  (jwtVerify as any).mockResolvedValueOnce({ payload: CLAIMS });
  (prisma.organizationMembership.findFirst as any).mockResolvedValueOnce({ id: "m1", organizationId: "org_1", userId: "u1", role, status: "active" });
  (prisma.user.create as any)?.mockResolvedValue({ id: "u1" });
  (prisma.user.findUnique as any).mockResolvedValue({ id: "u1" });
}

function req(method: string, url: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, { method, headers: { authorization: "Bearer x" }, body: body ? JSON.stringify(body) : undefined });
}

describe("scope routes", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("GET /scope-sets requires scope.view", async () => {
    await setupUser("report_viewer", prisma);
    const res = await GET(req("GET", "/api/v1/scope-sets"));
    expect(res.status).toBe(403);
  });

  it("POST /scope-sets requires scope.manage and returns 201", async () => {
    await setupUser("security_admin", prisma);
    const { createScopeSet } = await import("@/lib/scope/service");
    (createScopeSet as any).mockResolvedValue({ id: "s1", organizationId: "org_1", name: "PCI" });
    const res = await POST(req("POST", "/api/v1/scope-sets", { name: "PCI" }));
    expect(res.status).toBe(201);
  });
});
```
Then create the five route files, each gating per the Interfaces above and delegating to the services. For the nested routes, follow the Phase 3 `[scanId]` params convention: `{ params }: { params: Promise<{ ... }> }` + `await params`.

- [ ] **Step 2: Run test to verify it fails then passes**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/app/api/v1/scope-sets/route.test.ts`
Expected: FAIL (404 — route files absent) then PASS after implementation.

- [ ] **Step 3: Add OpenAPI contract**

Extend `portal/spec/openapi.yaml` with paths `/scope-sets`, `/scope-sets/{scopeSetId}/versions`, `/scope-versions/{versionId}/submit`, `/scope-versions/{versionId}/approve`, `/scope-versions/{versionId}/authorization` (bearerAuth; 200/201/400/401/403/404/409) and schemas `ScopeSet`, `ScopeVersion`, `ScopeItem`, `Authorization`, `AuthorizationIssued`. Extend `portal/src/lib/openapi/contract.test.ts` with a new describe block asserting these paths + schemas exist.

- [ ] **Step 4: Full suite + commit**

```bash
git add portal/src/app/api/v1/scope-sets portal/src/app/api/v1/scope-versions portal/spec/openapi.yaml portal/src/lib/openapi/contract.test.ts
git commit -m "feat(portal): scope + authorization API routes and contract"
```

---

## Task 6: Dispute service + routes

**Files:**
- Create: `portal/src/lib/disputes/service.ts`, `portal/src/lib/disputes/service.test.ts`
- Create: `portal/src/app/api/v1/findings/[findingId]/disputes/route.ts`, `portal/src/app/api/v1/disputes/[disputeId]/moderate/route.ts`
- Modify: `portal/src/lib/auth/rbac.ts` (`finding.dispute`, `dispute.moderate`), `portal/src/lib/auth/rbac.test.ts`, `portal/src/lib/http-error.ts` (`DisputeGuardError` → 409), `portal/spec/openapi.yaml`, `portal/src/lib/openapi/contract.test.ts`

**Interfaces:**
- Consumes: Task 1 `Dispute` model (+ `Finding.disputes`), `getScan`, `listFindings`, rbac, routeErrorResponse.
- Produces:
  - `export class DisputeGuardError extends Error {}`
  - `export async function raiseDispute(ctx, findingId: string, input: { justification: string }): Promise<Dispute>` — finding must exist in org (else `Error("Finding not found")`); justification non-empty ≤ 2000; `finding.dispute` gate is enforced at the ROUTE (service takes ctx; the route gates `can(ctx,"finding.dispute")`); creates Dispute status open; audit `finding.dispute.raised`.
  - `export async function moderateDispute(ctx, disputeId: string, input: { status: "resolved" | "rejected"; note?: string }): Promise<Dispute | null>` — dispute must exist in org; prod requires `ctx.isStaff` (else `DisputeGuardError("dispute moderation requires a staff reviewer in prod")`); open→resolved|rejected (guard `only open disputes can be moderated`); sets moderatedById/At + resolutionNote; audit `finding.dispute.moderated`. Returns null if not found.
  - `export async function listDisputes(ctx, filter?: { findingId?: string }): Promise<Dispute[]>` — org-scoped.
  - Routes: `POST /api/v1/findings/{findingId}/disputes` (gate `finding.dispute`; 201; wrap DisputeGuardError/Error notFound "Finding not found" in routeErrorResponse) and `POST /api/v1/disputes/{disputeId}/moderate` (gate `dispute.moderate`; body `{status, note?}`; 400 invalid status; 404; 200).

- [ ] **Step 1: Add RBAC + guard-error mappings**

In `portal/src/lib/auth/rbac.ts` add:
```ts
if (action === "finding.dispute") return hasRole(user, "organization_owner", "security_admin", "asset_manager", "scan_operator", "report_viewer");
if (action === "dispute.moderate") return hasRole(user, "organization_owner", "security_admin");
```
+ rbac.test assertions. In `portal/src/lib/http-error.ts`, import `DisputeGuardError` from `@/lib/disputes/service` and add `instanceof DisputeGuardError` → 409.

- [ ] **Step 2: Write the failing dispute test**

Create `portal/src/lib/disputes/service.test.ts` (real-DB harness like Task 2: org_scope_disp_0001/user_scope_disp_0001, a COMPLETED scan + a finding seeded via the scan service/findings harness — reuse `portal/src/lib/scan/report.test.ts` or `findings.test.ts` patterns; simplest: seed org+user+asset, create scan via createScanFromAssets, run RUNNING→COMPLETED via transitionScanStatus, ingest a finding via ingestFindings, then raise/moderate):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { resolveTenantContext } from "@/lib/tenant";
import { createScanFromAssets, transitionScanStatus } from "@/lib/scan/service";
import { ingestFindings } from "@/lib/scan/findings";
import { raiseDispute, moderateDispute, DisputeGuardError, listDisputes } from "./service";

const ORG = "org_scope_disp_0001";
const USER = "user_scope_disp_0001";
const STAFF = "user_scope_disp_0002";
let ctx: any;
let staffCtx: any;
let scanId: string;
let findingId: string;

// seed org/user(owner)/staff(user with role report_viewer, isStaff true) + asset_scope_disp_1 + membership
// harness identical in style to earlier tasks (admin pg inserts); then:
async function buildScanAndFinding() {
  const { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion } = await import("@/lib/scope/service");
  const set = await createScopeSet(ctx, { name: "Disc" });
  const version = await createScopeVersion(ctx, set.id, { assetIds: ["asset_scope_disp_1"] });
  await submitScopeVersion(ctx, version.id);
  await approveScopeVersion(ctx, version.id);
  const scan = await createScanFromAssets(ctx, { name: "d", assetIds: ["asset_scope_disp_1"] });
  scanId = scan.id;
  await transitionScanStatus(ctx, scanId, "RUNNING");
  await transitionScanStatus(ctx, scanId, "COMPLETED");
  const { count } = await ingestFindings(ctx, scanId, [
    { assetId: "asset_scope_disp_1", qid: "q1", severity: "4", title: "Weak TLS" },
  ]);
  findingId = (await prisma.$transaction(async (tx) => {
    const { setRlsContext } = await import("@/lib/tenant");
    await setRlsContext(ORG, tx);
    return (await tx.finding.findFirst({ where: { scanId } }))!;
  })).id;
}

beforeAll(async () => { /* seed + buildScanAndFinding() */ });
afterAll(async () => { /* wipe + disconnect */ });

describe("dispute service", () => {
  it("raises a dispute with justification and lists it", async () => {
    const d = await raiseDispute(ctx, findingId, { justification: "not our host" });
    expect(d.status).toBe("open");
    const all = await listDisputes(ctx, { findingId });
    expect(all.some((x) => x.id === d.id)).toBe(true);
  });

  it("moderates an open dispute; guards states and prod staff", async () => {
    const d = await raiseDispute(ctx, findingId, { justification: "dispute" });
    await expect(moderateDispute(ctx, d.id, { status: "rejected", note: "no" })).rejects.toThrowError(/staff|prod/i);
    const resolved = await moderateDispute(staffCtx, d.id, { status: "resolved", note: "confirmed" });
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolutionNote).toBe("confirmed");
    await expect(moderateDispute(staffCtx, d.id, { status: "rejected", note: "again" })).rejects.toThrowError(/only open disputes/i);
  });
});
```
(Adjust the `ctx`/`staffCtx` construction: the non-staff owner ctx must have `appMode: "prod"` + `isStaff: false` for the prod staff gate to fire — stub `APP_MODE=prod` via `vi.stubEnv` around the moderate call or set process.env in beforeAll and restore in afterAll. Staff ctx: `isStaff: true`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/disputes/service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the dispute service**

Create `portal/src/lib/disputes/service.ts`:
```ts
import { prisma } from "@/lib/prisma-client";
import { setRlsContext, getAppMode } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, Dispute } from "@/lib/generated/prisma";

export class DisputeGuardError extends Error {}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

export async function raiseDispute(ctx: TenantContext, findingId: string, input: { justification: string }): Promise<Dispute> {
  const justification = input.justification.trim();
  if (!justification || justification.length > 2000) throw new DisputeGuardError("justification must be a non-empty string up to 2000 chars");
  return withTenant(ctx.organizationId, async (tx) => {
    const finding = await tx.finding.findUnique({ where: { id: findingId } });
    if (!finding) throw new Error("Finding not found");
    const dispute = await tx.dispute.create({
      data: { findingId, organizationId: ctx.organizationId, justification, raisedById: ctx.userId },
    });
    await recordAudit(ctx, "finding.dispute.raised", "Dispute", dispute.id, undefined, { findingId, justification }, undefined, tx);
    return dispute;
  });
}

export async function moderateDispute(
  ctx: TenantContext,
  disputeId: string,
  input: { status: "resolved" | "rejected"; note?: string }
): Promise<Dispute | null> {
  if (!["resolved", "rejected"].includes(input.status)) throw new DisputeGuardError("status must be resolved or rejected");
  return withTenant(ctx.organizationId, async (tx) => {
    const dispute = await tx.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) return null;
    if (getAppMode() === "prod" && !ctx.isStaff) throw new DisputeGuardError("dispute moderation requires a staff reviewer in prod");
    if (dispute.status !== "open") throw new DisputeGuardError("only open disputes can be moderated");
    const updated = await tx.dispute.update({
      where: { id: disputeId },
      data: { status: input.status, resolutionNote: input.note ?? null, moderatedById: ctx.userId, moderatedAt: new Date() },
    });
    await recordAudit(ctx, "finding.dispute.moderated", "Dispute", disputeId, { status: "open" }, { status: input.status, note: input.note ?? null }, undefined, tx);
    return updated;
  });
}

export async function listDisputes(ctx: TenantContext, filter: { findingId?: string } = {}): Promise<Dispute[]> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.dispute.findMany({
      where: { organizationId: ctx.organizationId, ...(filter.findingId ? { findingId: filter.findingId } : {}) },
      orderBy: { createdAt: "desc" },
    })
  );
}
```

- [ ] **Step 5: Implement the dispute routes + contract**

Create `portal/src/app/api/v1/findings/[findingId]/disputes/route.ts` (POST; gate `finding.dispute`; Next 16 params; 201 → `{dispute}`; wrap in routeErrorResponse with notFound "Finding not found"). Create `portal/src/app/api/v1/disputes/[disputeId]/moderate/route.ts` (POST; gate `dispute.moderate`; 400 invalid status; 404; 200 → dispute). Add OpenAPI paths + schemas `Dispute`, `DisputeModeration` and extend the contract test.

- [ ] **Step 6: Run tests + full suite + commit**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/disputes/service.test.ts` → PASS (2 tests). Then full `vitest run` → green.

```bash
git add portal/src/lib/disputes portal/src/app/api/v1/findings portal/src/app/api/v1/disputes portal/src/lib/auth/rbac.ts portal/src/lib/auth/rbac.test.ts portal/src/lib/http-error.ts portal/spec/openapi.yaml portal/src/lib/openapi/contract.test.ts
git commit -m "feat(portal): dispute flow — raise with justification, QA moderation (prod-staff-gated)"
```

---

## Task 7: Exit criteria + handoff

**Files:**
- Create: `portal/src/lib/scope/exit.test.ts`
- Modify: `portal/src/lib/scan/exit.test.ts` (extend the spec↔route conformance walk to include scope/dispute paths), `AGENTS.md`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: the exit proof — scope gate blocks unapproved scans in prod; approved scope yields a signed authorization that verifies; a dispute can be raised and moderated; contract routes exist.

- [ ] **Step 1: Write the exit test**

Create `portal/src/lib/scope/exit.test.ts` (real-DB, two orgs, fixed unique ids `org_scope_exit_a_001`/`org_scope_exit_b_001`/`user_scope_exit_a_001`/`user_scope_exit_b_001`/`asset_scope_exit_1`; follow the harness of `portal/src/lib/scan/exit.test.ts`):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { prisma } from "@/lib/prisma-client";
import { resolveTenantContext } from "@/lib/tenant";
import { createScanFromAssets, getScan, transitionScanStatus } from "@/lib/scan/service";
import { ingestFindings } from "@/lib/scan/findings";
import { createScopeSet, createScopeVersion, submitScopeVersion, approveScopeVersion, assetInApprovedScope } from "@/lib/scope/service";
import { issueAuthorization, verifyAuthorizationSignature, getAuthorization } from "@/lib/scope/authorization";
import { raiseDispute, moderateDispute, listDisputes } from "@/lib/disputes/service";

const ORG_A = "org_scope_exit_a_001";
const ORG_B = "org_scope_exit_b_001";
const USER_A = "user_scope_exit_a_001";
const USER_B = "user_scope_exit_b_001";
let ctxA: any;
let staffA: any;
let ctxB: any;

describe("phase 4 exit criteria", () => {
  beforeAll(async () => { /* seed both orgs + users + owner memberships + asset_scope_exit_1 (verified, active) in A; wipe patterns identical to scan/exit.test.ts */ });

  it("zero-scan until an approved scope version; gate + authorization + dispute end-to-end", async () => {
    // 1. Prod gate blocks unapproved scan
    const { default: vi } = await import("vitest");
    vi.stubEnv("APP_MODE", "prod");
    const assetCtrl = { ...ctxA, isStaff: false };
    await expect(createScanFromAssets(assetCtrl, { name: "no", assetIds: ["asset_scope_exit_1"] })).rejects.toThrow(/approved scope version/i);
    vi.unstubAllEnvs();

    // 2. Approve a scope version → gate passes in prod
    const set = await createScopeSet(ctxA, { name: "PCI" });
    const version = await createScopeVersion(ctxA, set.id, { assetIds: ["asset_scope_exit_1"] });
    await submitScopeVersion(ctxA, version.id);
    await approveScopeVersion(ctxA, version.id);
    expect(await assetInApprovedScope(ctxA, "asset_scope_exit_1")).toBe(true);
    expect(await assetInApprovedScope(ctxB, "asset_scope_exit_1")).toBe(false);

    vi.stubEnv("APP_MODE", "prod");
    const mockProd = { ...ctxA, isStaff: false };
    const scan = await createScanFromAssets(mockProd, { name: "run", assetIds: ["asset_scope_exit_1"] });
    vi.unstubAllEnvs();
    await transitionScanStatus(ctxA, scan.id, "RUNNING");
    await transitionScanStatus(ctxA, scan.id, "COMPLETED");
    await ingestFindings(ctxA, scan.id, [{ assetId: "asset_scope_exit_1", qid: "q-exit", severity: "4", title: "Weak TLS" }]);

    // 3. Signed authorization verifies
    const auth = await issueAuthorization(ctxA, version.id);
    expect(verifyAuthorizationSignature(auth)).toBe(true);
    expect(auth.scopeVersionHash).toBe(version.contentHash);
    expect((await getAuthorization(ctxA, version.id))?.id).toBe(auth.id);

    // 4. Dispute raised then moderated (staff in prod)
    const finding = (await getScan(ctxA, scan.id))!;
    const findingRow = await prisma.$transaction(async (tx) => {
      const { setRlsContext } = await import("@/lib/tenant");
      await setRlsContext(ORG_A, tx);
      return (await tx.finding.findFirst({ where: { scanId: scan.id } }))!;
    });
    const d = await raiseDispute(ctxA, findingRow.id, { justification: "not our host" });
    vi.stubEnv("APP_MODE", "prod");
    await expect(moderateDispute(ctxA, d.id, { status: "rejected", note: "n" })).rejects.toThrow(/staff/i);
    const moderated = await moderateDispute(staffA, d.id, { status: "resolved", note: "confirmed" });
    vi.unstubAllEnvs();
    expect(moderated?.status).toBe("resolved");
    expect((await listDisputes(ctxA, { findingId: findingRow.id })).length).toBeGreaterThanOrEqual(1);
  });

  it("contract routes exist for scope/auth/disputes", () => {
    const spec = yaml.load(fs.readFileSync(path.join(process.cwd(), "spec", "openapi.yaml"), "utf-8")) as Record<string, any>;
    for (const p of [
      "/scope-sets",
      "/scope-sets/{scopeSetId}/versions",
      "/scope-versions/{versionId}/submit",
      "/scope-versions/{versionId}/approve",
      "/scope-versions/{versionId}/authorization",
      "/findings/{findingId}/disputes",
      "/disputes/{disputeId}/moderate",
    ]) {
      expect(spec.paths?.[p], `missing path ${p}`).toBeDefined();
    }
    const files = walk("src/app/api/v1");
    expect(files).toContain("src/app/api/v1/scope-sets/route.ts");
    expect(files).toContain("src/app/api/v1/disputes/route.ts".replace("route.ts", ""));
  });
});
```
Extend `portal/src/lib/scan/exit.test.ts`'s spec↔route conformance walk regex from `/^(scans|reports)(\/|$)/` to also match `scope-sets`, `scope-versions`, `disputes`, `findings/.../disputes` (mirror the existing walk; keep the {param}→[param] conversion).

(Note: the exact test-1/path assertions are the contract; adapt the harness to the existing `portal/src/lib/scan/exit.test.ts` wipe/seed conventions, including distinct idpIds so they don't collide with scan/exit's `kc-exit-a`.)

- [ ] **Step 2: Run the exit test + full suites**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scope/exit.test.ts` → PASS (2 tests).
Then full: `npx --cache /home/cchock/projects/.npm-cache vitest run` → green (baseline 283 + all Phase 4 additions). Run the full suite TWICE to confirm no idpId-style parallel flake.

- [ ] **Step 3: Update AGENTS.md**

In root `AGENTS.md`: replace the `- **NEXT:** Phase 4 = versioned scope & authorization + dispute flow.` line with a `- **Phase 4 DONE** (...)` bullet + `- **NEXT:** <next phase>`. Update the test-count line (Phase 3b bullet says 278; the fresh full-suite result goes in — read the ACTUAL count from your run). Add env note if needed (no new env vars; MANIFEST_SECRET already documented).

- [ ] **Step 4: Commit**

```bash
git add portal/src/lib/scope/exit.test.ts portal/src/lib/scan/exit.test.ts AGENTS.md
git commit -m "test(portal): Phase 4 exit criteria + docs: handoff"
```

---

## Self-Review

**Spec coverage:** §4 models ScopeSet/ScopeVersion/ScopeItem + Authorization (statement+scope-version hash) + Dispute → Tasks 1-3 + 6. §5.5 scope-approval gate → Task 4 (prod gate in createScanFromAssets). §5 step-10 dispute flow + QA moderation → Task 6 (raise/moderate, prod staff gate). CIDR-as-boundary preserved (scope items snapshot an asset's canonicalIdentifier as-is; never expanded). RLS + grants on all five tables in the same migration (Task 1). RBAC gates (Task 2/3/6). Contract + routes (Tasks 5/6). Exit criteria (Task 7).

**Placeholder scan:** every task carries exact code + commands; no TBD. The route tests (Task 5) and the contest portions of Task 7's exit test are specified by enumerated assertions + explicit "follow the existing pattern" references to concrete Phase 3 files — the same accepted approach used in Phases 3/3b. No undefined types: `ScopeGuardError` (Task 2) used in Tasks 3/5; `assetInApprovedScope` (Task 2) used in Task 4; `authorizationSignature`/`issueAuthorization`/`getAuthorization`/`verifyAuthorizationSignature` (Task 3) used in Tasks 5/7; `scopeContentHash` (Task 2) used in Tasks 2/3/7; disputes (Task 6) used in Task 7.

**Type consistency:** `createScopeSet(ctx, {name, description?})`, `createScopeVersion(ctx, scopeSetId, {assetIds})`, `submitScopeVersion(ctx, versionId)`, `approveScopeVersion(ctx, versionId)`, `assetInApprovedScope(ctx, assetId)`, `issueAuthorization(ctx, scopeVersionId)`, `moderateDispute(ctx, disputeId, {status, note?})` — consistent names/signatures across tasks. `contentHash` computed in Task 2's `createScopeVersion` and frozen at approval; `Authorization.scopeVersionHash` must equal it (Task 3 asserts). Route files match the OpenAPI contract (Task 7 walks them).

## Handoff note for Phase 5

Phase 4 delivers the scope-approval gate (§5.5: no scan without an approved scope version — enforced in prod at scan creation) and the documented-signed `Authorization` (statement hash + scope-version hash, HMAC-bound, verifiable), plus the dispute flow (customer raises with justification; QA moderates resolved/rejected with a prod staff gate). Next phase candidates per the design: scanning UI wiring (assets → scope → scan), report finalization gate wiring (a report is not final until QA-attested AND its scope version is approved — currently the attestation gate exists; the scope link can be surfaced on the report), and the CVE/scoring source (VulDB or Kali/Greenbone local DBs — deferred from Phase 3b, feeds cveId/severity/pciSeverity into findings).