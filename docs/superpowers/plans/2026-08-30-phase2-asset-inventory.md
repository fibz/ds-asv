# Phase 2: Asset Inventory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-tenant asset inventory: canonical assets (IPv4/IPv6/CIDR/FQDN), normalization, manual + CSV creation, dedupe, lifecycle (retire-not-delete), ownership fields, and a DNS/manual verification workflow — plus revive the deferred API-key surface (RLS + grants + routes), which is the **Phase 2 FIRST task** per AGENTS.md.

**Architecture:** Control plane is Next.js + PostgreSQL (RLS). Every tenant table carries `organizationId` and is isolated by RLS policies keyed on the transaction-scoped `app.tenant_id` session variable. Assets are durable; retirement is a lifecycle transition, never a hard delete. API-key machine auth (X-API-Key, salted hashes) needs a bootstrap SELECT path because the key lookup runs before any tenant context exists — same pattern as `membership_bootstrap`.

**Tech Stack:** Next.js 16 + TypeScript, Prisma 7 + PostgreSQL (RLS), Node `net` for IP validation, Vitest. `npm`/`npx` only (pnpm is broken in this sandbox).

**Spec:** `docs/superpowers/specs/2026-08-29-ds-asv-pci-portal-design.md` (§4 models, §10 Phase 2 exit criterion) and `scanner/docs/Customer-Onboarding-Asset-Management-Design.md` (§4 lifecycle, §6 domain model + key constraints, §8 API shape, §11 Phase 2, §12 MVP boundary).

## Global Constraints

- RLS enforces `organization_id` isolation server-side; `asv_app` (DATABASE_URL) is the RLS-subject app role, `asv` (ADMIN_DATABASE_URL) is the migration/admin role that bypasses RLS. Tests use fixed ids + admin-role wipes, never global DELETEs (parallel workers share the DB).
- `set_config('app.tenant_id', ...)` is transaction-scoped: every tenant query runs inside `prisma.$transaction` with `setRlsContext(orgId, tx)`, and all tenant DML goes through that `tx` client.
- `organization_id` is derived from authenticated identity (`resolveTenantContext`), never from the URL or client input.
- **No legacy data migration** (owner directive): do NOT port `Customer.scope_ips` or any kilo/compliance-engine rows into `Asset`. Assets start empty; creation is manual + CSV only.
- MVP asset types only: `ipv4`, `ipv6`, `cidr`, `fqdn`. Defer cloud connectors, CMDB sync, advanced discovery, authenticated scans.
- **Retire, never delete.** Assets that appear in scope/scan/finding/report/audit history must be preserved. There is NO asset DELETE route.
- Unique active asset: partial unique index on `(organizationId, type, canonicalIdentifier)` WHERE `lifecycleState <> 'retired'`. Dedupe matches this.
- Every migration that adds a tenant table must, in the SAME migration: ENABLE ROW LEVEL SECURITY, add its policies, and GRANT the table to `asv_app` (fail-closed pattern from `20260829142337_rls_hardening`).
- Migrations: Prisma 7 — use `npx prisma migrate diff` (from migrations → schema datamodel) to generate SQL, append hand-authored RLS/grants/indexes to it, then `npx prisma migrate deploy` + `npx prisma generate`. Never `migrate dev` (non-interactive-unfriendly).
- `next build` requires `APP_MODE=prod` (prod-lock guard).
- Every task is TDD: write failing test → verify fail → implement → verify pass → commit.
- RBAC: reuse `can(user, "asset.manage")` (already: org_owner/security_admin/asset_manager). API-key management gets a new `api-key.manage` action (org_owner/security_admin).
- Secret scanner on push flags `sk_live_*` literals and `postgresql://user:pass@` URLs even in tests — use `generateApiKey()`/placeholders, never hardcoded key strings or credentials in committed files.

---

## File Structure

```
portal/src/
├── lib/
│   ├── tenant.ts                      # MODIFY: + tenantContextFromRequest() (route auth helper)
│   ├── audit.ts                       # MODIFY: + optional tx client param
│   ├── auth/
│   │   ├── api-keys.ts                # MODIFY: + create/list/update/revoke/rotate service fns
│   │   ├── api-key-service.test.ts    # NEW: DB integration tests (withTenant pattern)
│   │   ├── requireScope.ts            # MODIFY: transaction + lookup flag + tenant-scoped update
│   │   └── requireScope.test.ts       # MODIFY: adapt to transaction shape
│   │   └── rbac.ts                    # MODIFY: + api-key.manage action
│   │   └── rbac.test.ts               # MODIFY: + api-key.manage cases
│   └── assets/
│       ├── normalize.ts               # NEW: pure canonicalization (ipv4/ipv6/cidr/fqdn)
│       ├── normalize.test.ts          # NEW
│       ├── service.ts                 # NEW: create/list/get/update/retire + dedupe + audit
│       ├── service.test.ts            # NEW: DB integration tests
│       ├── import.ts                  # NEW: CSV parse/preview/apply + idempotency + invalid rows
│       ├── import.test.ts             # NEW: parser unit + DB integration
│       └── verification.ts            # NEW: challenge create + token verify
│       └── verification.test.ts       # NEW
├── prisma/
│   ├── schema.prisma                  # MODIFY: Asset, AssetVerification, AssetImport
│   └── migrations/<ts>_phase2_*/      # NEW migrations (schema diff + RLS/grants/indexes appended)
└── src/app/api/v1/
    ├── auth/api-keys/route.ts         # MODIFY: revive POST/GET (remove 501)
    ├── auth/api-keys/[id]/route.ts    # MODIFY: revive GET/PATCH/DELETE
    ├── auth/api-keys/[id]/rotate/route.ts # MODIFY: revive POST
    └── assets/
        ├── route.ts                   # NEW: GET list, POST create
        ├── route.test.ts              # NEW
        ├── [id]/route.ts              # NEW: GET detail, PATCH
        ├── [id]/retire/route.ts       # NEW: POST retire
        ├── [id]/verification-challenges/route.ts # NEW: POST challenge
        ├── [id]/verify/route.ts       # NEW: POST verify
        ├── imports/route.ts           # NEW: POST import (CSV)
        └── imports/[id]/route.ts      # NEW: GET import result (invalid rows)
└── src/app/(dashboard)/
    ├── assets/page.tsx                # NEW: server list page (header-auth, mirrors dashboard)
    └── assets/[id]/page.tsx           # NEW: detail + verification + retire
└── src/components/dashboard/
    ├── sidebar.tsx                    # MODIFY: + Assets nav entry
    ├── AssetImportForm.tsx            # NEW: client CSV upload → preview → apply
    └── AssetTable.tsx                 # NEW: list/filter row rendering
```

---

## Task 1: ApiKey RLS migration + API-key service lib

**Files:**
- Create: `portal/prisma/migrations/20260830000001_phase2_api_key_rls/migration.sql`
- Modify: `portal/prisma/schema.prisma` (no model change needed — ApiKey exists; this migration only adds RLS/grants)
- Create: `portal/src/lib/auth/api-key-service.test.ts`
- Modify: `portal/src/lib/auth/api-keys.ts` (service functions)
- Modify: `portal/src/lib/audit.ts` (optional tx param)
- Modify: `portal/src/lib/auth/requireScope.ts` (add `isScope` export)

**Interfaces:**
- Consumes: `TenantContext` (`@/lib/tenant`), `recordAudit`, `generateApiKey`/`hashApiKey`/`maskApiKey`, `Scope` union.
- Produces: `createApiKey(ctx, {name, scopes, expiresAt}) → { id, name, key, scopes, expiresAt }` (raw key returned ONCE); `listApiKeys(ctx)` (masked); `updateApiKey(ctx, id, patch)`; `revokeApiKey(ctx, id)`; `rotateApiKey(ctx, id) → { id, name, key, scopes, expiresAt }`; `isScope(v)`.

- [ ] **Step 1: Write the failing migration**

Create `portal/prisma/migrations/20260830000001_phase2_api_key_rls/migration.sql`:

```sql
-- Phase 2, Task 1: ApiKey RLS + grants (fail-closed pattern).
-- Previously deferred: asv_app had NO grants on "ApiKey", and the v1
-- api-keys routes answered 501. This migration enables tenant isolation and
-- grants DML, plus a bootstrap SELECT path for machine-key auth.

ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: an ApiKey row is visible/mutable only by its owning org.
CREATE POLICY api_key_tenant_isolation ON "ApiKey"
  USING ("orgId" = current_setting('app.tenant_id', true))
  WITH CHECK ("orgId" = current_setting('app.tenant_id', true));

-- Bootstrap SELECT for machine auth (X-API-Key): requireScope() must find the
-- candidate key BEFORE any tenant context exists. The caller sets the
-- TRANSACTION-scoped flag app.api_key_lookup='1' around its candidate scan;
-- the flag is set only by the auth gate, never by tenant code. SELECT only —
-- writes still require a tenant context via the isolation policy above.
CREATE POLICY api_key_lookup_bootstrap ON "ApiKey"
  FOR SELECT
  USING (current_setting('app.api_key_lookup', true) = '1');

GRANT SELECT, INSERT, UPDATE, DELETE ON "ApiKey" TO asv_app;
```

- [ ] **Step 2: Apply the migration**

Run: `npx prisma migrate deploy && npx prisma generate` (from `portal/`, with `.env` loaded; `ADMIN_DATABASE_URL` connects as `asv`).
Expected: migration `20260830000001_phase2_api_key_rls` applied.

- [ ] **Step 3: Write the failing DB test**

`portal/src/lib/auth/api-key-service.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from "@/lib/auth/api-keys";
import type { TenantContext, Role } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_apikey_service_0001";
const USER = "user_apikey_service_0001";

function withTenant<T>(
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(organizationId, tx);
    return fn(tx);
  });
}

const ctx: TenantContext = {
  userId: USER,
  organizationId: ORG,
  role: "organization_owner",
  isStaff: false,
  appMode: "dev",
};

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    await admin.query(`DELETE FROM "ApiKey" WHERE "orgId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally {
    await admin.end();
  }
}

describe("api-key service (RLS + tenant scoping)", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "ApiKey Service Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-apikey-svc", email: "svc@x.com" } });
    });
  });

  afterAll(async () => {
    await adminWipe();
    await prisma.$disconnect();
  });

  it("creates a key under the tenant and returns the raw key once", async () => {
    const created = await createApiKey(ctx, { name: "ci", scopes: ["read:scans"] });
    expect(created.key).toMatch(/^sk_live_/);
    expect(created.id).toBeTruthy();

    // the stored row is scoped to the tenant
    await withTenant(ORG, async (tx) => {
      const row = await tx.apiKey.findUnique({ where: { id: created.id } });
      expect(row?.orgId).toBe(ORG);
      expect(row?.keyHash).not.toContain(created.key); // only the salted hash is stored
    });
  });

  it("lists only this tenant's keys, masked", async () => {
    const keys = await listApiKeys(ctx);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    for (const k of keys) {
      expect(k.maskedKey).toMatch(/^sk_live_/);
      expect(k.maskedKey).not.toContain("$"); // salt never leaks
    }
  });

  it("revokes a key (soft delete) and rotate issues a fresh key", async () => {
    const created = await createApiKey(ctx, { name: "rotate-me", scopes: ["admin"] });
    const rotated = await rotateApiKey(ctx, created.id);
    expect(rotated.key).not.toBe(created.key);
    const list = await listApiKeys(ctx);
    expect(list.find((k) => k.id === created.id)?.revokedAt).toBeTruthy();

    await revokeApiKey(ctx, rotated.id);
    const after = await listApiKeys(ctx);
    expect(after.find((k) => k.id === rotated.id)?.revokedAt).toBeTruthy();
  });

  it("cannot read or touch another tenant's key", async () => {
    const otherOrg = "org_apikey_foreign_9999";
    await withTenant(otherOrg, async (tx) => {
      await tx.organization.create({ data: { id: otherOrg, name: "Foreign" } });
    });
    // foreign org's key row
    await prisma.$transaction(async (tx) => {
      await setRlsContext(otherOrg, tx);
      await tx.apiKey.create({
        data: {
          name: "foreign",
          keyHash: "salt$hash",
          scopes: ["admin"],
          orgId: otherOrg,
        },
      });
    });
    // tenant ORG cannot see it, even by guessed id (RLS hides the row)
    const rows = await prisma.$transaction(async (tx) => {
      await setRlsContext(ORG, tx);
      return tx.apiKey.findMany();
    });
    expect(rows.every((r) => r.orgId === ORG)).toBe(true);
    // cleanup foreign org (admin)
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await admin.connect();
    await admin.query(`DELETE FROM "ApiKey" WHERE "orgId" = $1`, [otherOrg]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [otherOrg]);
    await admin.end();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/api-key-service.test.ts`
Expected: FAIL — `createApiKey`/`listApiKeys`/`revokeApiKey`/`rotateApiKey` not exported from `@/lib/auth/api-keys`.

- [ ] **Step 5: Implement the service**

Append to `portal/src/lib/auth/api-keys.ts`:

```ts
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";

export interface ApiKeyServiceInput {
  name: string;
  scopes: string[];
  expiresAt?: Date | null;
}

/** Creates a key for the tenant; returns the raw key exactly once. */
export async function createApiKey(ctx: TenantContext, input: ApiKeyServiceInput) {
  const rawKey = generateApiKey();
  const keyHash = await hashApiKey(rawKey);
  const created = await prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const key = await tx.apiKey.create({
      data: {
        name: input.name,
        keyHash,
        scopes: input.scopes,
        orgId: ctx.organizationId,
        expiresAt: input.expiresAt ?? null,
      },
    });
    await recordAudit(
      ctx, "api-key.create", "ApiKey", key.id,
      undefined, { name: key.name, scopes: key.scopes }, undefined, tx
    );
    return key;
  });
  return { id: created.id, name: created.name, key: rawKey, scopes: created.scopes, expiresAt: created.expiresAt };
}

/** Lists the tenant's keys with masked hashes (never the salt or raw key). */
export async function listApiKeys(ctx: TenantContext) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const keys = await tx.apiKey.findMany({ orderBy: { createdAt: "desc" } });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      maskedKey: maskApiKey(k.keyHash),
      scopes: k.scopes,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    }));
  });
}

/** Updates mutable fields of one of the tenant's keys. */
export async function updateApiKey(
  ctx: TenantContext,
  id: string,
  patch: { name?: string; scopes?: string[]; expiresAt?: Date | null }
) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const before = await tx.apiKey.findUnique({ where: { id } });
    if (!before) throw new Error("API key not found");
    const updated = await tx.apiKey.update({
      where: { id },
      data: {
        name: patch.name ?? before.name,
        scopes: patch.scopes ?? before.scopes,
        expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : before.expiresAt,
      },
    });
    await recordAudit(ctx, "api-key.update", "ApiKey", id, { name: before.name }, { name: updated.name }, undefined, tx);
    return updated;
  });
}

/** Soft-revokes a key (sets revokedAt). Never a hard delete. */
export async function revokeApiKey(ctx: TenantContext, id: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const before = await tx.apiKey.findUnique({ where: { id } });
    if (!before) throw new Error("API key not found");
    const updated = await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await recordAudit(ctx, "api-key.revoke", "ApiKey", id, { revokedAt: null }, { revokedAt: updated.revokedAt }, undefined, tx);
    return updated;
  });
}

/** Revokes the old key and issues a fresh one with the same name + scopes. */
export async function rotateApiKey(ctx: TenantContext, id: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const before = await tx.apiKey.findUnique({ where: { id } });
    if (!before) throw new Error("API key not found");
    const rawKey = generateApiKey();
    const keyHash = await hashApiKey(rawKey);
    await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    const created = await tx.apiKey.create({
      data: { name: before.name, keyHash, scopes: before.scopes, orgId: ctx.organizationId },
    });
    await recordAudit(ctx, "api-key.rotate", "ApiKey", id, { revokedAt: null }, { revokedAt: new Date() }, "rotated", tx);
    return { id: created.id, name: created.name, key: rawKey, scopes: created.scopes, expiresAt: created.expiresAt };
  });
}
```

Add the optional `tx` param to `portal/src/lib/audit.ts` (keep existing behavior for the no-tx callers):

```ts
import { prisma } from "@/lib/prisma-client";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

export async function recordAudit(
  ctx: TenantContext,
  action: string,
  resourceType: string,
  resourceId?: string,
  before?: unknown,
  after?: unknown,
  reason?: string,
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? prisma;
  return client.auditEvent.create({
    data: {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      resourceType,
      resourceId,
      before: before != null ? (before as any) : undefined,
      after: after != null ? (after as any) : undefined,
      reason,
    },
  });
}
```

Add `isScope` to `portal/src/lib/auth/requireScope.ts`:

```ts
export function isScope(value: unknown): value is Scope {
  return (
    typeof value === "string" &&
    (["read:scans","write:scans","read:waf","manage:waf","read:siem","write:siem","read:compliance","admin"] as const).includes(value as Scope)
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/api-key-service.test.ts`
Expected: PASS. If a 42501 (insufficient_privilege) surfaces, the migration's grants are missing — re-check `migration.sql`.

- [ ] **Step 7: Commit**

```bash
git add portal/prisma/migrations/20260830000001_phase2_api_key_rls portal/src/lib/auth/api-key-service.test.ts portal/src/lib/auth/api-keys.ts portal/src/lib/audit.ts portal/src/lib/auth/requireScope.ts
git commit -m "feat(portal): ApiKey RLS + grants + key service (create/list/revoke/rotate)"
```

---

## Task 2: requireScope tenant-safe fix + revive api-keys routes

**Files:**
- Modify: `portal/src/lib/auth/requireScope.ts`
- Modify: `portal/src/lib/auth/requireScope.test.ts`
- Modify: `portal/src/app/api/v1/auth/api-keys/route.ts`
- Modify: `portal/src/app/api/v1/auth/api-keys/[id]/route.ts`
- Modify: `portal/src/app/api/v1/auth/api-keys/[id]/rotate/route.ts`
- Modify: `portal/src/app/api/v1/auth/api-keys/route.test.ts`
- Modify: `portal/src/lib/auth/rbac.ts` + `portal/src/lib/auth/rbac.test.ts`
- Modify: `portal/src/lib/tenant.ts` (add `tenantContextFromRequest`)

**Interfaces:**
- Consumes: `createApiKey`/`listApiKeys`/`updateApiKey`/`revokeApiKey`/`rotateApiKey` (Task 1), `provisionKeycloakUser`, `resolveTenantContext`, `isScope`, `requireRole`.
- Produces: `tenantContextFromRequest(request) → TenantContext | null` (route auth helper); working v1 api-keys routes (401 unauthenticated → 403 forbidden → 2xx); `can(ctx, "api-key.manage")`.

- [ ] **Step 1: Write the failing test**

`portal/src/lib/auth/rbac.test.ts` — add to the existing describe:

```ts
it("api-key.manage requires owner or security_admin in prod", () => {
  const owner = { ...base, role: "organization_owner" as const };
  const sec = { ...base, role: "security_admin" as const };
  const viewer = { ...base, role: "report_viewer" as const };
  expect(can(owner, "api-key.manage")).toBe(true);
  expect(can(sec, "api-key.manage")).toBe(true);
  expect(can(viewer, "api-key.manage")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/rbac.test.ts`
Expected: FAIL — `can(base, "api-key.manage")` returns false for owner (action not handled).

- [ ] **Step 3: Implement RBAC + route auth helper**

In `portal/src/lib/auth/rbac.ts`, inside `can()` before the final `return false`:

```ts
if (action === "api-key.manage") return hasRole(user, "organization_owner", "security_admin");
```

In `portal/src/lib/tenant.ts`, add (import `provisionKeycloakUser` from `@/lib/auth/keycloak`):

```ts
/**
 * Route-handler auth helper: verifies the Bearer token, provisions the user,
 * then resolves tenant context from the active membership. Returns null when
 * unauthenticated or the user has no active org — callers respond 401.
 */
export async function tenantContextFromRequest(request: {
  headers: { get(name: string): string | null };
}): Promise<TenantContext | null> {
  const keycloakUser = await provisionKeycloakUser(request);
  if (!keycloakUser) return null;
  const user = await prisma.user.findUnique({ where: { idpId: keycloakUser.idpId } });
  if (!user) return null;
  try {
    return await resolveTenantContext(user.id);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run rbac test to verify it passes**

Run: `npx vitest run src/lib/auth/rbac.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix requireScope for RLS**

`portal/src/lib/auth/requireScope.ts` — wrap the candidate scan + `lastUsedAt` update in one transaction that sets the bootstrap flag, then the tenant context from the matched key:

```ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma-client";
import { hashApiKey, splitKeyHash } from "@/lib/auth/api-keys";

export type Scope =
  | "read:scans" | "write:scans" | "read:waf" | "manage:waf"
  | "read:siem" | "write:siem" | "read:compliance" | "admin";

const ADMIN_SCOPE: Scope = "admin";

export function isScope(value: unknown): value is Scope {
  return (
    typeof value === "string" &&
    (["read:scans","write:scans","read:waf","manage:waf","read:siem","write:siem","read:compliance","admin"] as const).includes(value as Scope)
  );
}

/**
 * Resolves the API key from the X-API-Key header and checks its scope.
 *
 * RLS-aware: the candidate scan runs inside one transaction that first sets
 * the bootstrap flag app.api_key_lookup='1' (SELECT-only policy
 * api_key_lookup_bootstrap — the key lookup must work before a tenant context
 * exists), and the lastUsedAt write runs in the SAME transaction after
 * app.tenant_id is set from the matched key's orgId, so the isolation
 * policy's WITH CHECK passes.
 */
export async function requireScope(
  request: NextRequest,
  required: Scope
): Promise<
  | { ok: true; key: { id: string; orgId: string; scopes: Scope[] } }
  | { ok: false; response: Response }
> {
  const rawKey = request.headers.get("X-API-Key");
  if (!rawKey) {
    return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.api_key_lookup', '1', true)`);
    const candidates = await tx.apiKey.findMany({ where: { revokedAt: null } });
    let apiKey: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      const parts = splitKeyHash(candidate.keyHash);
      if (!parts) continue;
      const computed = await hashApiKey(rawKey, parts.salt);
      if (computed === candidate.keyHash) { apiKey = candidate; break; }
    }
    if (!apiKey) {
      return { ok: false as const, response: Response.json({ error: "Invalid API key" }, { status: 401 }) };
    }
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return { ok: false as const, response: Response.json({ error: "API key expired" }, { status: 401 }) };
    }
    const scopes = apiKey.scopes as Scope[];
    const hasAccess = scopes.includes(ADMIN_SCOPE) || scopes.includes(required);
    if (!hasAccess) {
      return { ok: false as const, response: Response.json({ error: "Insufficient scope", required }, { status: 403 }) };
    }
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, apiKey.orgId);
    await tx.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
    return { ok: true as const, key: { id: apiKey.id, orgId: apiKey.orgId, scopes } };
  });

  return result;
}
```

Update `portal/src/lib/auth/requireScope.test.ts`:
- The existing file mocks `@/lib/prisma-client` with a real client on `ADMIN_DATABASE_URL`. Keep that (the permission surface is not under test), but the test now exercises the transaction path. The mock exposes a real `PrismaClient`, so `$transaction` works unchanged. No seed changes needed; the assertions stay the same.
- Add one RLS regression case at the end of the describe:

```ts
it("updates lastUsedAt inside the tenant-scoped transaction", async () => {
  const res = await requireScope(reqWithKey(RAW_ADMIN), "read:scans");
  expect(res.ok).toBe(true);
  const row = await prisma.apiKey.findUnique({ where: { id: "ak_reqscope_admin" } });
  expect(row?.lastUsedAt).toBeTruthy();
});
```

- [ ] **Step 6: Run requireScope tests to verify they pass**

Run: `npx vitest run src/lib/auth/requireScope.test.ts`
Expected: PASS (all previous cases + the new one).

- [ ] **Step 7: Revive the routes**

`portal/src/app/api/v1/auth/api-keys/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { requireRole } from "@/lib/auth/rbac";
import { createApiKey, listApiKeys } from "@/lib/auth/api-keys";
import { isScope } from "@/lib/auth/requireScope";

export async function POST(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireRole(ctx, "organization_owner", "security_admin");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const scopes = Array.isArray(body?.scopes) ? body.scopes.filter(isScope) : [];
  if (!name || scopes.length === 0) {
    return NextResponse.json({ error: "name and at least one valid scope are required" }, { status: 400 });
  }
  const expiresAt = body?.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json({ error: "invalid expiresAt" }, { status: 400 });
  }
  const created = await createApiKey(ctx, { name, scopes, expiresAt });
  return NextResponse.json(
    { id: created.id, name: created.name, key: created.key, scopes: created.scopes, expiresAt: created.expiresAt?.toISOString() ?? null },
    { status: 201 }
  );
}

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireRole(ctx, "organization_owner", "security_admin");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const keys = await listApiKeys(ctx);
  return NextResponse.json({
    keys: keys.map((k) => ({
      id: k.id, name: k.name, maskedKey: k.maskedKey, scopes: k.scopes,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      revokedAt: k.revokedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    })),
  });
}
```

`portal/src/app/api/v1/auth/api-keys/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma-client";
import { tenantContextFromRequest, setRlsContext } from "@/lib/tenant";
import { requireRole } from "@/lib/auth/rbac";
import { updateApiKey, revokeApiKey } from "@/lib/auth/api-keys";
import { isScope } from "@/lib/auth/requireScope";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const keys = await listKeysFor(ctx, id);
  if (!keys) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(keys);
}

// local helper: single masked key lookup (RLS-scoped findFirst)
async function listKeysFor(ctx: NonNullable<Awaited<ReturnType<typeof tenantContextFromRequest>>>, id: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const k = await tx.apiKey.findUnique({ where: { id } });
    if (!k) return null;
    return { id: k.id, name: k.name, scopes: k.scopes, revokedAt: k.revokedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() };
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireRole(ctx, "organization_owner", "security_admin");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const patch: { name?: string; scopes?: string[]; expiresAt?: Date | null } = {};
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (Array.isArray(body?.scopes)) {
    const scopes = body.scopes.filter(isScope);
    if (scopes.length) patch.scopes = scopes;
  }
  if (body?.expiresAt !== undefined) {
    patch.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (patch.expiresAt && Number.isNaN(patch.expiresAt.getTime())) {
      return NextResponse.json({ error: "invalid expiresAt" }, { status: 400 });
    }
  }
  try {
    const updated = await updateApiKey(ctx, id, patch);
    return NextResponse.json({ id: updated.id, name: updated.name, scopes: updated.scopes, revokedAt: updated.revokedAt?.toISOString() ?? null });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireRole(ctx, "organization_owner", "security_admin");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  try {
    await revokeApiKey(ctx, id);
    return NextResponse.json({ id, revoked: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
```

`portal/src/app/api/v1/auth/api-keys/[id]/rotate/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { requireRole } from "@/lib/auth/rbac";
import { rotateApiKey } from "@/lib/auth/api-keys";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireRole(ctx, "organization_owner", "security_admin");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const rotated = await rotateApiKey(ctx, id);
    return NextResponse.json({ id: rotated.id, name: rotated.name, key: rotated.key, scopes: rotated.scopes, expiresAt: rotated.expiresAt?.toISOString() ?? null });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
```

- [ ] **Step 8: Rewrite the route test (501 expectations → real behavior)**

`portal/src/app/api/v1/auth/api-keys/route.test.ts` — replace the 501 assertions. Keep the jose mock; change the prisma mock to expose `user` (create/findUnique) + `organizationMembership` (findFirst) + `apiKey` (create/findMany/findUnique/update) + `auditEvent` (create), all `vi.fn()`. Update `authedRequest` to also mock the membership lookup (`resolveTenantContext` path):

```ts
vi.mock("@/lib/prisma-client", () => {
  // the tx client handed to $transaction is the same mock object
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    apiKey: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return {
    prisma: {
      ...txMock,
      $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)),
    },
  };
});
```

Then rewrite the cases:

```ts
it("creates a key and returns the raw key once (201)", async () => {
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
  vi.mocked(prisma.apiKey.create).mockResolvedValueOnce({ id: "ak_1", name: "test key", keyHash: "salt$hash", scopes: ["admin"], orgId: "org_1" } as never);
  const request = authedRequest("/api/v1/auth/api-keys", {
    method: "POST",
    body: JSON.stringify({ name: "test key", scopes: ["admin"] }),
  });
  const response = await POST(request);
  expect(response.status).toBe(201);
  const data = await response.json();
  expect(data.key).toMatch(/^sk_live_/);
  expect(data.id).toBe("ak_1");
});

it("returns 400 for missing name or invalid scopes", async () => {
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
  const request = authedRequest("/api/v1/auth/api-keys", {
    method: "POST",
    body: JSON.stringify({ name: "", scopes: ["nope:scope"] }),
  });
  const response = await POST(request);
  expect(response.status).toBe(400);
});

it("returns 401 without a Bearer token", async () => {
  const request = new NextRequest("http://localhost/api/v1/auth/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "x", scopes: ["admin"] }),
  });
  const response = await POST(request);
  expect(response.status).toBe(401);
});

it("returns 403 for a non-manager role", async () => {
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "report_viewer", status: "active" } as never);
  const request = authedRequest("/api/v1/auth/api-keys", {
    method: "POST",
    body: JSON.stringify({ name: "x", scopes: ["admin"] }),
  });
  const response = await POST(request);
  expect(response.status).toBe(403);
});

it("lists keys for the tenant (200)", async () => {
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "organization_owner", status: "active" } as never);
  vi.mocked(prisma.apiKey.findMany).mockResolvedValueOnce([{ id: "ak_1", name: "k", keyHash: "salt$hash", scopes: ["admin"], orgId: "org_1", lastUsedAt: null, expiresAt: null, revokedAt: null, createdAt: new Date() }] as never);
  const request = authedRequest("/api/v1/auth/api-keys");
  const response = await GET(request);
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.keys[0].maskedKey).toMatch(/^sk_live_/);
});
```

Add similar cases for `[id]` PATCH/DELETE (200/404) and rotate (200 + new key) in the same file, following the same mock pattern. Remove the `expectNotImplemented` helper.

- [ ] **Step 9: Run the route tests to verify they pass**

Run: `npx vitest run src/app/api/v1/auth/api-keys`
Expected: PASS.

- [ ] **Step 10: Full suite + commit**

Run: `npx vitest run`
Expected: all green (94 previous + new cases).

```bash
git add portal/src/lib/auth/requireScope.ts portal/src/lib/auth/requireScope.test.ts portal/src/app/api/v1/auth/api-keys portal/src/lib/auth/rbac.ts portal/src/lib/auth/rbac.test.ts portal/src/lib/tenant.ts
git commit -m "feat(portal): revive api-key routes (RLS-aware requireScope, RBAC api-key.manage)"
```

---

## Task 3: Asset/AssetVerification/AssetImport models + migration

**Files:**
- Modify: `portal/prisma/schema.prisma`
- Create: `portal/prisma/migrations/20260830000002_phase2_assets/migration.sql`

**Interfaces:**
- Consumes: `Organization` (parent model).
- Produces: `Asset` (type, canonicalIdentifier, displayName, owner, environment, criticality, lifecycleState, verificationState, source, lastSeenAt), `AssetVerification` (method, status, challengeHash, verifiedBy, expiresAt), `AssetImport` (idempotencyKey, status, summary, invalidRows) — all with `organizationId` + RLS + grants; partial unique dedupe index.

- [ ] **Step 1: Update the schema**

In `portal/prisma/schema.prisma`, add to `Organization`:

```prisma
  assets            Asset[]
  assetVerifications AssetVerification[]
  assetImports      AssetImport[]
```

Add the models (end of file):

```prisma
// Durable inventory object. MVP types: ipv4, ipv6, cidr, fqdn.
// Lifecycle: draft, pending_verification, active, suspended, retiring, retired,
// rejected. NEVER hard-delete — retire instead (scope/scan/finding/report/audit
// history depends on the row). Dedupe: partial unique index in the migration
// on (organizationId, type, canonicalIdentifier) WHERE lifecycleState <> 'retired'.
model Asset {
  id                  String   @id @default(cuid())
  organizationId      String
  type                String // ipv4 | ipv6 | cidr | fqdn
  canonicalIdentifier String // normalized (lowercase fqdn, collapsed ip, masked cidr)
  displayName         String?
  owner               String? // accountable owner (name/email) — ownership contact
  environment         String? // production | staging | development | test | other
  criticality         String   @default("medium") // low | medium | high | critical
  lifecycleState      String   @default("pending_verification")
  verificationState   String   @default("unverified") // unverified | pending | verified | expired
  source              String   @default("manual") // manual | csv_import
  lastSeenAt          DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  organization        Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  verifications       AssetVerification[]

  @@index([organizationId])
  @@index([organizationId, type])
  @@index([organizationId, lifecycleState])
  @@index([organizationId, canonicalIdentifier])
}

// Control/authority evidence for one asset. method: dns_txt | manual.
// status: pending | verified | expired | failed. Challenge tokens are stored
// as SHA-256 hashes (challengeHash), never raw.
model AssetVerification {
  id             String   @id @default(cuid())
  organizationId String
  assetId        String
  method         String // dns_txt | manual
  status         String   @default("pending")
  challengeHash  String?
  verifiedBy     String?
  expiresAt      DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  asset          Asset    @relation(fields: [assetId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([assetId])
  @@index([organizationId])
  @@index([status])
}

// Idempotent CSV import record. Replaying the same idempotencyKey returns the
// stored result instead of re-applying. invalidRows carries the downloadable
// error report for the UI (exit criterion: invalid rows downloadable).
model AssetImport {
  id             String   @id @default(cuid())
  organizationId String
  idempotencyKey String
  status         String   @default("completed")
  summary        Json // { total, created, duplicates, invalid }
  invalidRows    Json // [{ row: {...}, errors: string[] }]
  createdBy      String
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, idempotencyKey])
  @@index([organizationId])
}
```

- [ ] **Step 2: Generate + hand-augment the migration**

Run:
```bash
mkdir -p prisma/migrations/20260830000002_phase2_assets
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$ADMIN_DATABASE_URL" \
  --script > prisma/migrations/20260830000002_phase2_assets/migration.sql
```
(The shadow DB must be a THROWAWAY database, not the live `asv_portal`. Create it once as `asv`: `createdb -h localhost -p 5433 -U asv asv_shadow` — then export `SHADOW_DATABASE_URL=postgresql://asv:CHANGE_ME@localhost:5433/asv_shadow` and pass that. Prisma creates/drops tables in the shadow during diff; pointing it at the real DB risks destructive DDL.)

Append to the generated `migration.sql` (after the CREATE TABLE / index statements):

```sql
-- Phase 2, Task 3: RLS + grants + dedupe index (fail-closed pattern).

ALTER TABLE "Asset" ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_tenant_isolation ON "Asset"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "AssetVerification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_verification_tenant_isolation ON "AssetVerification"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "AssetImport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_import_tenant_isolation ON "AssetImport"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "Asset" TO asv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "AssetVerification" TO asv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "AssetImport" TO asv_app;

-- Unique ACTIVE asset: (organizationId, type, canonicalIdentifier). Retired
-- assets are preserved historically, so they may be re-added later; every
-- other lifecycle state participates in dedupe. This is the backstop for
-- service-level dedupe (import races cannot create duplicates).
CREATE UNIQUE INDEX "Asset_active_unique"
  ON "Asset"("organizationId", "type", "canonicalIdentifier")
  WHERE "lifecycleState" <> 'retired';
```

- [ ] **Step 3: Apply + generate**

Run: `npx prisma migrate deploy && npx prisma generate`
Expected: migration applied, client regenerated with the three new models.

- [ ] **Step 4: Verify with a smoke test**

Run: `node -e "const {PrismaClient}=require('./src/lib/generated/prisma'); console.log('models ok')"` — or simpler, run the existing suite to confirm nothing broke:

Run: `npx vitest run src/lib/prisma-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/prisma/schema.prisma portal/prisma/migrations/20260830000002_phase2_assets
git commit -m "feat(portal): asset inventory models (Asset, AssetVerification, AssetImport) + RLS + dedupe index"
```

---

## Task 4: Asset normalization lib

**Files:**
- Create: `portal/src/lib/assets/normalize.ts`
- Create: `portal/src/lib/assets/normalize.test.ts`

**Interfaces:**
- Produces: `type AssetType = "ipv4" | "ipv6" | "cidr" | "fqdn"`; `isAssetType(v)`; `normalizeIpv4(raw)`, `normalizeIpv6(raw)`, `normalizeCidr(raw)`, `normalizeFqdn(raw)`, `normalizeIdentifier(type, raw)` — each throws `Error` with a readable message on invalid input and returns the canonical string.

- [ ] **Step 1: Write the failing test**

`portal/src/lib/assets/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeIpv4, normalizeIpv6, normalizeCidr, normalizeFqdn,
  normalizeIdentifier, isAssetType,
} from "@/lib/assets/normalize";

describe("normalizeIpv4", () => {
  it("canonicalizes (strips leading zeros, trims)", () => {
    expect(normalizeIpv4(" 010.0.0.1 ")).toBe("10.0.0.1");
    expect(normalizeIpv4("192.168.001.010")).toBe("192.168.1.10");
  });
  it("rejects malformed input", () => {
    expect(() => normalizeIpv4("10.0.0")).toThrow();
    expect(() => normalizeIpv4("10.0.0.999")).toThrow();
    expect(() => normalizeIpv4("a.b.c.d")).toThrow();
  });
});

describe("normalizeIpv6", () => {
  it("lowercases and compresses", () => {
    expect(normalizeIpv6("2001:0DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(normalizeIpv6("::1")).toBe("::1");
    expect(normalizeIpv6("fe80::1")).toBe("fe80::1");
  });
  it("rejects malformed input", () => {
    expect(() => normalizeIpv6("2001:db8:::1")).toThrow();
    expect(() => normalizeIpv6("not-an-ip")).toThrow();
  });
});

describe("normalizeCidr", () => {
  it("masks to the network boundary", () => {
    expect(normalizeCidr("10.0.0.5/24")).toBe("10.0.0.0/24");
    expect(normalizeCidr("192.168.1.99/26")).toBe("192.168.1.64/26");
  });
  it("canonicalizes ipv6 cidr", () => {
    expect(normalizeCidr("2001:db8::1/64")).toBe("2001:db8::/64");
  });
  it("rejects bad prefixes", () => {
    expect(() => normalizeCidr("10.0.0.0/33")).toThrow();
    expect(() => normalizeCidr("10.0.0.0/ab")).toThrow();
    expect(() => normalizeCidr("10.0.0.0")).toThrow();
  });
});

describe("normalizeFqdn", () => {
  it("lowercases and strips the trailing dot", () => {
    expect(normalizeFqdn("WWW.Example.COM.")).toBe("www.example.com");
  });
  it("rejects invalid labels", () => {
    expect(() => normalizeFqdn("-bad.example.com")).toThrow();
    expect(() => normalizeFqdn("exa mple.com")).toThrow();
    expect(() => normalizeFqdn("")).toThrow();
  });
});

describe("normalizeIdentifier + isAssetType", () => {
  it("dispatches by type", () => {
    expect(normalizeIdentifier("ipv4", "010.0.0.1")).toBe("10.0.0.1");
    expect(normalizeIdentifier("fqdn", "API.Example.COM.")).toBe("api.example.com");
  });
  it("isAssetType accepts exactly the four MVP types", () => {
    for (const t of ["ipv4", "ipv6", "cidr", "fqdn"]) expect(isAssetType(t)).toBe(true);
    expect(isAssetType("hostname")).toBe(false);
    expect(isAssetType(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/assets/normalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement normalization**

`portal/src/lib/assets/normalize.ts`:

```ts
import { isIP } from "net";

export type AssetType = "ipv4" | "ipv6" | "cidr" | "fqdn";

export const ASSET_TYPES: readonly AssetType[] = ["ipv4", "ipv6", "cidr", "fqdn"];

export function isAssetType(value: unknown): value is AssetType {
  return typeof value === "string" && (ASSET_TYPES as readonly string[]).includes(value);
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function normalizeIpv4(raw: string): string {
  const trimmed = raw.trim();
  const m = IPV4_RE.exec(trimmed);
  if (!m) throw new Error(`Invalid IPv4 address: ${raw}`);
  const octets = m.slice(1).map((o) => {
    const n = Number(o);
    if (n > 255) throw new Error(`IPv4 octet out of range: ${raw}`);
    return n;
  });
  return octets.join(".");
}

const IPV6_RE = /^[0-9a-f:]+$/i;

/** Expands an IPv6 string (with optional ::) into 8 lowercase hex groups. */
function expandIpv6(raw: string): string[] {
  const lower = raw.toLowerCase();
  const dc = lower.indexOf("::");
  let groups: string[];
  if (dc !== -1) {
    const left = lower.slice(0, dc).split(":").filter(Boolean);
    const right = lower.slice(dc + 2).split(":").filter(Boolean);
    const missing = 8 - left.length - right.length;
    if (missing < 1) throw new Error(`Invalid IPv6 address: ${raw}`);
    groups = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    groups = lower.split(":").filter(Boolean);
  }
  if (groups.length !== 8) throw new Error(`Invalid IPv6 address: ${raw}`);
  return groups.map((g) => {
    if (!/^[0-9a-f]{1,4}$/.test(g)) throw new Error(`Invalid IPv6 address: ${raw}`);
    return g.padStart(4, "0");
  });
}

/** Compresses 8 groups per RFC 5952 (leftmost-longest zero run → ::). */
function compressIpv6(groups: string[]): string {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  for (let i = 0; i <= groups.length; i++) {
    if (i < groups.length && groups[i] === "0000") {
      if (curStart === -1) curStart = i;
    } else {
      if (curStart !== -1) {
        const len = i - curStart;
        if (len > bestLen) { bestStart = curStart; bestLen = len; }
        curStart = -1;
      }
    }
  }
  const strip = (g: string) => g.replace(/^0+(?=[0-9a-f])/, "");
  if (bestLen >= 2) {
    const head = groups.slice(0, bestStart).map(strip).join(":");
    const tail = groups.slice(bestStart + bestLen).map(strip).join(":");
    return `${head}::${tail}`;
  }
  return groups.map(strip).join(":");
}

export function normalizeIpv6(raw: string): string {
  const trimmed = raw.trim();
  if (!IPV6_RE.test(trimmed) || isIP(trimmed, 6) !== 6) {
    throw new Error(`Invalid IPv6 address: ${raw}`);
  }
  return compressIpv6(expandIpv6(trimmed));
}

function ipv6ToBigInt(groups: string[]): bigint {
  let n = 0n;
  for (const g of groups) n = (n << 16n) | BigInt(parseInt(g, 16));
  return n;
}

function bigIntToIpv6Groups(n: bigint): string[] {
  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) {
    // NOTE: push, not unshift — i runs 7→0 (most-significant first), so
    // pushing preserves order. unshift here reverses the groups (plan bug
    // fixed during Task 4; the brief's own test proved it).
    groups.push(((n >> BigInt(i * 16)) & 0xffffn).toString(16).padStart(4, "0"));
  }
  return groups;
}

export function normalizeCidr(raw: string): string {
  const trimmed = raw.trim();
  const slash = trimmed.indexOf("/");
  if (slash === -1) throw new Error(`Invalid CIDR (missing prefix): ${raw}`);
  const ip = trimmed.slice(0, slash);
  const prefixStr = trimmed.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixStr)) throw new Error(`Invalid CIDR prefix: ${raw}`);
  const prefix = Number(prefixStr);
  const isV4 = isIP(ip, 4) === 4;
  const isV6 = isIP(ip, 6) === 6;
  if (!isV4 && !isV6) throw new Error(`Invalid CIDR address: ${raw}`);
  const maxPrefix = isV4 ? 32 : 128;
  if (prefix > maxPrefix) throw new Error(`CIDR prefix out of range: ${raw}`);

  if (isV4) {
    const octets = ip.split(".").map(Number);
    let bits = prefix;
    const masked = octets.map((o, i) => {
      const keep = Math.max(0, Math.min(8, bits));
      bits -= keep;
      if (keep === 0) return 0;
      const mask = ((0xff << (8 - keep)) & 0xff);
      return o & mask;
    });
    return `${masked.join(".")}/${prefix}`;
  }

  const groups = expandIpv6(ip);
  const addr = ipv6ToBigInt(groups);
  const mask = prefix === 0 ? 0n : (0xffffffffffffffffffffffffffffffffn << BigInt(128 - prefix)) & 0xffffffffffffffffffffffffffffffffn;
  const masked = bigIntToIpv6Groups(addr & mask);
  return `${compressIpv6(masked)}/${prefix}`;
}

const FQDN_LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function normalizeFqdn(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/\.+$/, "");
  if (trimmed.length === 0 || trimmed.length > 253) {
    throw new Error(`Invalid FQDN: ${raw}`);
  }
  const labels = trimmed.split(".");
  for (const label of labels) {
    if (label.length === 0 || label.length > 63 || !FQDN_LABEL_RE.test(label)) {
      throw new Error(`Invalid FQDN label in: ${raw}`);
    }
  }
  return trimmed;
}

export function normalizeIdentifier(type: AssetType, raw: string): string {
  switch (type) {
    case "ipv4": return normalizeIpv4(raw);
    case "ipv6": return normalizeIpv6(raw);
    case "cidr": return normalizeCidr(raw);
    case "fqdn": return normalizeFqdn(raw);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/assets/normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/assets/normalize.ts portal/src/lib/assets/normalize.test.ts
git commit -m "feat(portal): asset identifier normalization (ipv4/ipv6/cidr/fqdn)"
```

---

## Task 5: Asset service (create/list/get/update/retire + dedupe)

**Files:**
- Create: `portal/src/lib/assets/service.ts`
- Create: `portal/src/lib/assets/service.test.ts`

**Interfaces:**
- Consumes: `normalizeIdentifier`/`isAssetType` (Task 4), `TenantContext`, `setRlsContext`, `recordAudit`.
- Produces: `createAsset(ctx, input)`, `listAssets(ctx, filters)`, `getAsset(ctx, id)`, `updateAsset(ctx, id, patch)`, `retireAsset(ctx, id)`, `class DuplicateAssetError extends Error { existingAssetId }`.

- [ ] **Step 1: Write the failing DB test**

`portal/src/lib/assets/service.test.ts` (fixed ids + admin wipe, same shape as the api-key service test):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createAsset, listAssets, getAsset, updateAsset, retireAsset, DuplicateAssetError } from "@/lib/assets/service";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_asset_svc_0001";
const ORG2 = "org_asset_svc_0002";
const USER = "user_asset_svc_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "asset_manager", isStaff: false, appMode: "dev" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG, ORG2]) {
      await admin.query(`DELETE FROM "AssetVerification" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "AssetImport" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("asset service", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Asset Svc Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-asset-svc", email: "svc@x.com" } });
    });
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("creates an asset with a canonical identifier", async () => {
    const a = await createAsset(ctx, { type: "ipv4", identifier: "010.0.0.1", displayName: "web" });
    expect(a.canonicalIdentifier).toBe("10.0.0.1");
    expect(a.lifecycleState).toBe("pending_verification");
    expect(a.verificationState).toBe("unverified");
  });

  it("dedupes: same (org, type, canonical) is a DuplicateAssetError", async () => {
    await createAsset(ctx, { type: "fqdn", identifier: "WWW.Example.COM" });
    await expect(createAsset(ctx, { type: "fqdn", identifier: "www.example.com." }))
      .rejects.toBeInstanceOf(DuplicateAssetError);
  });

  it("retired assets can be re-added (dedupe index excludes retired)", async () => {
    const a = await createAsset(ctx, { type: "ipv6", identifier: "2001:db8::1" });
    await retireAsset(ctx, a.id);
    const again = await createAsset(ctx, { type: "ipv6", identifier: "2001:0db8:0:0:0:0:0:1" });
    expect(again.canonicalIdentifier).toBe("2001:db8::1");
  });

  it("lists and filters by type + lifecycle", async () => {
    const all = await listAssets(ctx, {});
    expect(all.length).toBeGreaterThanOrEqual(3);
    const v4 = await listAssets(ctx, { type: "ipv4" });
    expect(v4.every((a) => a.type === "ipv4")).toBe(true);
    const retired = await listAssets(ctx, { lifecycleState: "retired" });
    expect(retired.length).toBeGreaterThanOrEqual(1);
  });

  it("get/update/retire are tenant-scoped and audited", async () => {
    const a = await createAsset(ctx, { type: "fqdn", identifier: "api.example.com", criticality: "high" });
    const updated = await updateAsset(ctx, a.id, { displayName: "API Gateway", owner: "sec@example.com" });
    expect(updated.displayName).toBe("API Gateway");

    const before = await getAsset(ctx, a.id);
    await retireAsset(ctx, a.id);
    const after = await getAsset(ctx, a.id);
    expect(after?.lifecycleState).toBe("retired");
    expect(before?.id).toBe(after?.id); // row preserved, not deleted

    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { resourceId: a.id }, orderBy: { createdAt: "asc" } }));
    expect(audits.map((e) => e.action)).toEqual(["asset.create", "asset.update", "asset.retire"]);
  });

  it("cross-tenant: cannot see or mutate another org's asset", async () => {
    await withTenant(ORG2, async (tx) => { await tx.organization.create({ data: { id: ORG2, name: "Other" } }); });
    const foreign = await prisma.$transaction(async (tx) => {
      await setRlsContext(ORG2, tx);
      return tx.asset.create({ data: { organizationId: ORG2, type: "ipv4", canonicalIdentifier: "9.9.9.9" } });
    });
    expect(await getAsset(ctx, foreign.id)).toBeNull();
    await expect(retireAsset(ctx, foreign.id)).rejects.toThrow();
    // cleanup
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await admin.connect();
    await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [ORG2]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG2]);
    await admin.end();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/assets/service.test.ts`
Expected: FAIL — module `@/lib/assets/service` not found.

- [ ] **Step 3: Implement the service**

`portal/src/lib/assets/service.ts`:

```ts
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { normalizeIdentifier, isAssetType, type AssetType } from "@/lib/assets/normalize";
import type { TenantContext } from "@/lib/tenant";

export class DuplicateAssetError extends Error {
  constructor(public existingAssetId: string) {
    super(`Asset already exists (id ${existingAssetId})`);
    this.name = "DuplicateAssetError";
  }
}

export interface AssetInput {
  type: string;
  identifier: string;
  displayName?: string;
  owner?: string;
  environment?: string;
  criticality?: string;
}

export interface AssetFilters {
  type?: string;
  lifecycleState?: string;
  criticality?: string;
  search?: string; // matches displayName or canonicalIdentifier (case-insensitive)
}

const CRITICALITIES = ["low", "medium", "high", "critical"];
const ENVIRONMENTS = ["production", "staging", "development", "test", "other"];

function assertAssetInput(input: AssetInput): void {
  if (!isAssetType(input.type)) throw new Error(`Invalid asset type: ${input.type}`);
  if (input.criticality && !CRITICALITIES.includes(input.criticality)) {
    throw new Error(`Invalid criticality: ${input.criticality}`);
  }
  if (input.environment && !ENVIRONMENTS.includes(input.environment)) {
    throw new Error(`Invalid environment: ${input.environment}`);
  }
  // normalize (throws on invalid) — canonicalIdentifier is computed here
  normalizeIdentifier(input.type as AssetType, input.identifier);
}

/** Creates an asset under the tenant. Dedupe: throws DuplicateAssetError on an
 * existing NON-retired asset with the same (org, type, canonicalIdentifier). */
export async function createAsset(ctx: TenantContext, input: AssetInput) {
  assertAssetInput(input);
  const canonicalIdentifier = normalizeIdentifier(input.type as AssetType, input.identifier);
  try {
    return await prisma.$transaction(async (tx) => {
      await setRlsContext(ctx.organizationId, tx);
      const existing = await tx.asset.findFirst({
        where: { organizationId: ctx.organizationId, type: input.type, canonicalIdentifier, lifecycleState: { not: "retired" } },
      });
      if (existing) throw new DuplicateAssetError(existing.id);
      const asset = await tx.asset.create({
        data: {
          organizationId: ctx.organizationId,
          type: input.type,
          canonicalIdentifier,
          displayName: input.displayName ?? null,
          owner: input.owner ?? null,
          environment: input.environment ?? null,
          criticality: input.criticality ?? "medium",
          lifecycleState: "pending_verification",
          verificationState: "unverified",
          source: "manual",
        },
      });
      await recordAudit(ctx, "asset.create", "Asset", asset.id, undefined, { type: asset.type, canonicalIdentifier }, undefined, tx);
      return asset;
    });
  } catch (error) {
    // partial unique index backstop (race): surface as DuplicateAssetError
    if (isUniqueViolation(error)) {
      const existing = await findExisting(ctx, input.type, canonicalIdentifier);
      if (existing) throw new DuplicateAssetError(existing.id);
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string } };
  return e?.code === "P2002" || e?.meta?.code === "P2002";
}

async function findExisting(ctx: TenantContext, type: string, canonicalIdentifier: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    return tx.asset.findFirst({
      where: { organizationId: ctx.organizationId, type, canonicalIdentifier, lifecycleState: { not: "retired" } },
    });
  });
}

export async function listAssets(ctx: TenantContext, filters: AssetFilters) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const where: Record<string, unknown> = {};
    if (filters.type) where.type = filters.type;
    if (filters.lifecycleState) where.lifecycleState = filters.lifecycleState;
    if (filters.criticality) where.criticality = filters.criticality;
    if (filters.search) {
      where.OR = [
        { displayName: { contains: filters.search, mode: "insensitive" } },
        { canonicalIdentifier: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    return tx.asset.findMany({ where, orderBy: { createdAt: "desc" } });
  });
}

export async function getAsset(ctx: TenantContext, id: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    return tx.asset.findFirst({ where: { id, organizationId: ctx.organizationId } });
  });
}

/** Cosmetic + ownership fields only. Canonical identifier/type changes are
 * material changes (design §4 change rules) — done via retire + re-create. */
export async function updateAsset(ctx: TenantContext, id: string, patch: { displayName?: string; owner?: string; environment?: string; criticality?: string }) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const before = await tx.asset.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw new Error("Asset not found");
    if (patch.criticality && !CRITICALITIES.includes(patch.criticality)) throw new Error(`Invalid criticality: ${patch.criticality}`);
    if (patch.environment && !ENVIRONMENTS.includes(patch.environment)) throw new Error(`Invalid environment: ${patch.environment}`);
    const updated = await tx.asset.update({
      where: { id },
      data: {
        displayName: patch.displayName !== undefined ? patch.displayName : before.displayName,
        owner: patch.owner !== undefined ? patch.owner : before.owner,
        environment: patch.environment !== undefined ? patch.environment : before.environment,
        criticality: patch.criticality !== undefined ? patch.criticality : before.criticality,
      },
    });
    await recordAudit(ctx, "asset.update", "Asset", id, { displayName: before.displayName, owner: before.owner }, { displayName: updated.displayName, owner: updated.owner }, undefined, tx);
    return updated;
  });
}

/** Transition to retired. NEVER deletes — scope/scan/finding/report/audit
 * history depends on the row (design §4: never hard-delete a referenced asset). */
export async function retireAsset(ctx: TenantContext, id: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const before = await tx.asset.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw new Error("Asset not found");
    const updated = await tx.asset.update({ where: { id }, data: { lifecycleState: "retired" } });
    await recordAudit(ctx, "asset.retire", "Asset", id, { lifecycleState: before.lifecycleState }, { lifecycleState: "retired" }, undefined, tx);
    return updated;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/assets/service.test.ts`
Expected: PASS. If the dedupe test fails with a raw P2002 (not DuplicateAssetError), the service's catch path needs the unique-violation detection verified.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/assets/service.ts portal/src/lib/assets/service.test.ts
git commit -m "feat(portal): asset service (create/list/get/update/retire, dedupe, audit)"
```

---

## Task 6: CSV import service (parse/preview/apply, idempotent, invalid rows)

**Files:**
- Create: `portal/src/lib/assets/import.ts`
- Create: `portal/src/lib/assets/import.test.ts`

**Interfaces:**
- Consumes: `normalizeIdentifier`/`isAssetType` (Task 4), `createAsset`/`DuplicateAssetError` (Task 5), `TenantContext`, `setRlsContext`, `recordAudit`.
- Produces: `parseCsv(text) → AssetImportRow[]`; `previewImport(ctx, rows) → { rows: PreviewRow[] }` (per-row status: new | duplicate | invalid); `applyImport(ctx, rows, idempotencyKey) → { importId, summary, invalidRows }`; `getImportResult(ctx, importId)`.

- [ ] **Step 1: Write the failing test**

`portal/src/lib/assets/import.test.ts` — pure parser cases first, then a DB integration case:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { parseCsv, previewImport, applyImport, getImportResult } from "@/lib/assets/import";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_asset_import_0001";
const USER = "user_asset_import_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "asset_manager", isStaff: false, appMode: "dev" };

describe("parseCsv", () => {
  it("parses a header + rows with quoted fields", () => {
    const csv = `type,identifier,display_name,owner,environment,criticality\nipv4,10.0.0.1,"Web, prod",a@b.com,production,high\nfqdn,api.example.com,API,,staging,`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ type: "ipv4", identifier: "10.0.0.1", displayName: "Web, prod", owner: "a@b.com", environment: "production", criticality: "high" });
    expect(rows[1].identifier).toBe("api.example.com");
  });
  it("throws on an unknown column header", () => {
    expect(() => parseCsv("type,bogus\nipv4,1.2.3.4")).toThrow(/unknown column/i);
  });
  it("throws on empty input or missing header", () => {
    expect(() => parseCsv("")).toThrow();
    expect(() => parseCsv("10.0.0.1\n")).toThrow();
  });
});

describe("CSV import (idempotent, invalid rows downloadable)", () => {
  beforeAll(async () => {
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await admin.connect();
    try {
      await admin.query(`DELETE FROM "AssetImport" WHERE "organizationId" = $1`, [ORG]);
      await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [ORG]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
      await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
    } finally { await admin.end(); }
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Import Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-import", email: "imp@x.com" } });
    });
  });

  afterAll(async () => {
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await admin.connect();
    try {
      await admin.query(`DELETE FROM "AssetImport" WHERE "organizationId" = $1`, [ORG]);
      await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [ORG]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
      await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
    } finally { await admin.end(); }
    await prisma.$disconnect();
  });

  it("previews rows as new/duplicate/invalid without writing", async () => {
    // seed one asset so it reads as duplicate in the preview
    await withTenant(ORG, async (tx) => {
      await tx.asset.create({ data: { organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.0.0.1" } });
    });
    const rows = parseCsv(`type,identifier,display_name\nipv4,10.0.0.1,dup\nipv4,10.0.0.2,fresh\nfqdn,-bad.com,invalid\n`);
    const preview = await previewImport(ctx, rows);
    const statuses = Object.fromEntries(preview.rows.map((r) => [r.row.identifier, r.status]));
    expect(statuses["10.0.0.1"]).toBe("duplicate");
    expect(statuses["10.0.0.2"]).toBe("new");
    expect(statuses["-bad.com"]).toBe("invalid");
    // nothing written by preview
    const count = await withTenant(ORG, (tx) => tx.asset.count());
    expect(count).toBe(1);
  });

  it("applies an import idempotently and records invalid rows", async () => {
    // NOTE (fixed during Task 6): the original brief CSV here was internally
    // unsatisfiable — 3 rows but 4 asserted outcomes, a comment referencing a
    // 10.0.0.1 row that wasn't in the CSV, and an invalid row (999.1.1.1)
    // whose error can't match /invalid/i. The minimal consistent data: add the
    // duplicate row (10.0.0.1 is the seeded asset) and use the preview test's
    // invalid fqdn row. 4 rows → created=2, duplicates=1, invalid=1, count=3.
    const rows = parseCsv(`type,identifier,display_name,owner\nipv4,10.0.0.2,app-1,a@b.com\nfqdn,api.example.com,api,a@b.com\nipv4,10.0.0.1,dup,a@b.com\nfqdn,-bad.com,invalid,\n`);
    const first = await applyImport(ctx, rows, "imp-key-1");
    expect(first.summary.created).toBe(2);
    expect(first.summary.duplicates).toBe(1); // 10.0.0.1 already exists
    expect(first.summary.invalid).toBe(1);
    expect(first.invalidRows).toHaveLength(1);
    expect(first.invalidRows[0].errors.join(" ")).toMatch(/invalid/i);

    // idempotency: replaying the same key returns the stored result, no new rows
    const replay = await applyImport(ctx, rows, "imp-key-1");
    expect(replay.importId).toBe(first.importId);
    const count = await withTenant(ORG, (tx) => tx.asset.count());
    expect(count).toBe(3); // 10.0.0.1 seed + 2 created

    // result is retrievable (downloadable invalid rows)
    const stored = await getImportResult(ctx, first.importId);
    expect((stored?.summary as { created?: number } | undefined)?.created).toBe(2);
    expect((stored?.invalidRows as unknown[] | undefined)?.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/assets/import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the import service**

`portal/src/lib/assets/import.ts`:

```ts
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { normalizeIdentifier, isAssetType, type AssetType } from "@/lib/assets/normalize";
import { createAsset, DuplicateAssetError } from "@/lib/assets/service";
import type { TenantContext } from "@/lib/tenant";

export interface AssetImportRow {
  type: string;
  identifier: string;
  displayName?: string;
  owner?: string;
  environment?: string;
  criticality?: string;
}

const KNOWN_COLUMNS = new Set(["type", "identifier", "display_name", "owner", "environment", "criticality"]);

/** Minimal RFC-4180-ish CSV parser: quoted fields, embedded commas/quotes. */
export function parseCsv(text: string): AssetImportRow[] {
  if (!text.trim()) throw new Error("CSV is empty");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const [header, ...body] = rows;
  if (!header) throw new Error("CSV is missing a header row");
  for (const col of header) {
    if (!KNOWN_COLUMNS.has(col.trim())) throw new Error(`Unknown column: ${col.trim()}`);
  }
  return body.map((cells) => {
    const obj: AssetImportRow = { type: "", identifier: "" };
    header.forEach((col, idx) => {
      const value = (cells[idx] ?? "").trim();
      switch (col.trim()) {
        case "type": obj.type = value; break;
        case "identifier": obj.identifier = value; break;
        case "display_name": obj.displayName = value || undefined; break;
        case "owner": obj.owner = value || undefined; break;
        case "environment": obj.environment = value || undefined; break;
        case "criticality": obj.criticality = value || undefined; break;
      }
    });
    return obj;
  });
}

function validateRow(row: AssetImportRow): { canonical?: string; errors: string[] } {
  const errors: string[] = [];
  if (!isAssetType(row.type)) errors.push(`invalid type "${row.type}"`);
  if (!row.identifier) errors.push("missing identifier");
  let canonical: string | undefined;
  if (errors.length === 0) {
    try {
      canonical = normalizeIdentifier(row.type as AssetType, row.identifier);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { canonical, errors };
}

/** Classifies each row without writing: new | duplicate | invalid. */
export async function previewImport(ctx: TenantContext, rows: AssetImportRow[]) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const results = [];
    for (const row of rows) {
      const { canonical, errors } = validateRow(row);
      if (errors.length > 0) { results.push({ row, status: "invalid", errors }); continue; }
      const existing = await tx.asset.findFirst({
        where: { organizationId: ctx.organizationId, type: row.type, canonicalIdentifier: canonical, lifecycleState: { not: "retired" } },
      });
      results.push(existing ? { row, status: "duplicate", errors: [], existingAssetId: existing.id } : { row, status: "new", errors: [] });
    }
    return { rows: results };
  });
}

/** Applies an import idempotently. Replaying idempotencyKey returns the stored
 * AssetImport result instead of re-applying. Invalid rows are recorded and
 * retrievable via getImportResult (downloadable error report). */
export async function applyImport(ctx: TenantContext, rows: AssetImportRow[], idempotencyKey: string) {
  if (!idempotencyKey) throw new Error("Idempotency-Key header is required for imports");
  const created: string[] = [];
  const duplicates: string[] = [];
  const invalidRows: { row: AssetImportRow; errors: string[] }[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const { canonical, errors } = validateRow(row);
    if (errors.length > 0) { invalidRows.push({ row, errors }); continue; }
    const dedupeKey = `${row.type}|${canonical}`;
    if (seen.has(dedupeKey)) { duplicates.push(canonical!); continue; }
    seen.add(dedupeKey);
    try {
      const asset = await createAsset(ctx, {
        type: row.type, identifier: canonical!, displayName: row.displayName,
        owner: row.owner, environment: row.environment, criticality: row.criticality,
      });
      created.push(asset.id);
    } catch (e) {
      if (e instanceof DuplicateAssetError) { duplicates.push(canonical!); continue; }
      invalidRows.push({ row, errors: [(e as Error).message] });
    }
  }

  const summary = { total: rows.length, created: created.length, duplicates: duplicates.length, invalid: invalidRows.length };

  const record = await prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const existing = await tx.assetImport.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: ctx.organizationId, idempotencyKey } },
    });
    if (existing) return existing; // idempotent replay
    const createdRecord = await tx.assetImport.create({
      data: {
        organizationId: ctx.organizationId,
        idempotencyKey,
        status: "completed",
        summary: summary as object,
        invalidRows: invalidRows as object,
        createdBy: ctx.userId,
      },
    });
    await recordAudit(ctx, "asset.import", "AssetImport", createdRecord.id, undefined, summary, undefined, tx);
    return createdRecord;
  });

  return { importId: record.id, summary: record.summary as typeof summary, invalidRows: record.invalidRows as typeof invalidRows };
}

export async function getImportResult(ctx: TenantContext, importId: string) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    return tx.assetImport.findFirst({ where: { id: importId, organizationId: ctx.organizationId } });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/assets/import.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/assets/import.ts portal/src/lib/assets/import.test.ts
git commit -m "feat(portal): idempotent CSV asset import with preview + downloadable invalid rows"
```

---

## Task 7: Asset API routes

**Files:**
- Create: `portal/src/app/api/v1/assets/route.ts`
- Create: `portal/src/app/api/v1/assets/route.test.ts`
- Create: `portal/src/app/api/v1/assets/[id]/route.ts`
- Create: `portal/src/app/api/v1/assets/[id]/retire/route.ts`
- Create: `portal/src/app/api/v1/assets/imports/route.ts`
- Create: `portal/src/app/api/v1/assets/imports/[id]/route.ts`

**Interfaces:**
- Consumes: `tenantContextFromRequest`, `can`/`requireRole` (asset.manage), `createAsset`/`listAssets`/`getAsset`/`updateAsset`/`retireAsset`/`DuplicateAssetError` (Task 5), `parseCsv`/`previewImport`/`applyImport`/`getImportResult` (Task 6).
- Produces: `GET/POST /api/v1/assets`, `GET/PATCH /api/v1/assets/[id]`, `POST /api/v1/assets/[id]/retire`, `POST /api/v1/assets/imports` (multipart `csv` text + `Idempotency-Key`), `GET /api/v1/assets/imports/[id]`.

- [ ] **Step 1: Write the failing route tests**

`portal/src/app/api/v1/assets/route.test.ts` — mock `@/lib/prisma-client` with `user`/`organizationMembership`/`asset`/`auditEvent`/`$transaction` and mock jose, same shape as the api-keys route test; assert:

```ts
it("returns 401 without a Bearer token", async () => {
  const request = new NextRequest("http://localhost/api/v1/assets", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "ipv4", identifier: "10.0.0.1" }) });
  const response = await POST(request);
  expect(response.status).toBe(401);
});

it("creates an asset for a manager (201)", async () => {
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "asset_manager", status: "active" } as never);
  vi.mocked(prisma.asset.create).mockResolvedValueOnce({ id: "as_1", organizationId: "org_1", type: "ipv4", canonicalIdentifier: "10.0.0.1", lifecycleState: "pending_verification", verificationState: "unverified" } as never);
  vi.mocked(prisma.asset.findFirst).mockResolvedValueOnce(null);
  const request = authedRequest("/api/v1/assets", { method: "POST", body: JSON.stringify({ type: "ipv4", identifier: "010.0.0.1", displayName: "web" }) });
  const response = await POST(request);
  expect(response.status).toBe(201);
  const data = await response.json();
  expect(data.canonicalIdentifier).toBe("10.0.0.1");
});

it("returns 409 on duplicate", async () => {
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "asset_manager", status: "active" } as never);
  vi.mocked(prisma.asset.findFirst).mockResolvedValueOnce({ id: "as_existing" } as never);
  const request = authedRequest("/api/v1/assets", { method: "POST", body: JSON.stringify({ type: "ipv4", identifier: "10.0.0.1" }) });
  const response = await POST(request);
  expect(response.status).toBe(409);
});

it("returns 403 for report_viewer (cannot manage assets)", async () => {
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "report_viewer", status: "active" } as never);
  const request = authedRequest("/api/v1/assets", { method: "POST", body: JSON.stringify({ type: "ipv4", identifier: "10.0.0.1" }) });
  const response = await POST(request);
  expect(response.status).toBe(403);
});

it("lists assets (200)", async () => {
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ organizationId: "org_1", role: "asset_manager", status: "active" } as never);
  vi.mocked(prisma.asset.findMany).mockResolvedValueOnce([{ id: "as_1", type: "ipv4", canonicalIdentifier: "10.0.0.1" }] as never);
  const response = await GET(authedRequest("/api/v1/assets"));
  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/v1/assets/route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the routes**

`portal/src/app/api/v1/assets/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { createAsset, listAssets, DuplicateAssetError } from "@/lib/assets/service";

export async function POST(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "asset.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  try {
    const asset = await createAsset(ctx, {
      type: body?.type, identifier: body?.identifier,
      displayName: body?.displayName, owner: body?.owner,
      environment: body?.environment, criticality: body?.criticality,
    });
    return NextResponse.json(asset, { status: 201 });
  } catch (e) {
    if (e instanceof DuplicateAssetError) return NextResponse.json({ error: e.message, existingAssetId: e.existingAssetId }, { status: 409 });
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const assets = await listAssets(ctx, {
    type: searchParams.get("type") ?? undefined,
    lifecycleState: searchParams.get("lifecycleState") ?? undefined,
    criticality: searchParams.get("criticality") ?? undefined,
    search: searchParams.get("search") ?? undefined,
  });
  return NextResponse.json({ assets });
}
```

`portal/src/app/api/v1/assets/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { getAsset, updateAsset } from "@/lib/assets/service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const asset = await getAsset(ctx, id);
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(asset);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "asset.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  try {
    const updated = await updateAsset(ctx, id, {
      displayName: body?.displayName, owner: body?.owner,
      environment: body?.environment, criticality: body?.criticality,
    });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof Error && e.message === "Asset not found" ? 404 : 400 });
  }
}
```

`portal/src/app/api/v1/assets/[id]/retire/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { retireAsset } from "@/lib/assets/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "asset.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const retired = await retireAsset(ctx, id);
    return NextResponse.json({ id: retired.id, lifecycleState: retired.lifecycleState });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
```

`portal/src/app/api/v1/assets/imports/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { parseCsv, previewImport, applyImport } from "@/lib/assets/import";

export async function POST(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "asset.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  const body = await request.json().catch(() => null);
  const csvText = typeof body?.csv === "string" ? body.csv : "";
  const dryRun = body?.dryRun === true;
  if (!csvText) return NextResponse.json({ error: "csv is required" }, { status: 400 });
  try {
    const rows = parseCsv(csvText);
    if (dryRun) {
      const preview = await previewImport(ctx, rows);
      return NextResponse.json({ preview });
    }
    if (!idempotencyKey) return NextResponse.json({ error: "Idempotency-Key header is required" }, { status: 400 });
    const result = await applyImport(ctx, rows, idempotencyKey);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
```

`portal/src/app/api/v1/assets/imports/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { getImportResult } from "@/lib/assets/import";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const record = await getImportResult(ctx, id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(record);
}
```

- [ ] **Step 4: Run route tests to verify they pass**

Run: `npx vitest run src/app/api/v1/assets/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run: `npx vitest run`
Expected: all green.

```bash
git add portal/src/app/api/v1/assets
git commit -m "feat(portal): asset API routes (crud, retire, csv import)"
```

---

## Task 8: Verification workflow

**Files:**
- Create: `portal/src/lib/assets/verification.ts`
- Create: `portal/src/lib/assets/verification.test.ts`
- Create: `portal/src/app/api/v1/assets/[id]/verification-challenges/route.ts`
- Create: `portal/src/app/api/v1/assets/[id]/verify/route.ts`

**Interfaces:**
- Consumes: `getAsset` (Task 5), `TenantContext`, `setRlsContext`, `recordAudit`, `createHash`/`randomBytes`.
- Produces: `createVerificationChallenge(ctx, assetId, method) → { verificationId, method, token, recordName?, expiresAt }` (token returned once, hash stored); `verifyAssetToken(ctx, assetId, token)`.

- [ ] **Step 1: Write the failing test**

`portal/src/lib/assets/verification.test.ts` — DB test with fixed ids (mirror service.test.ts shape; seed one fqdn asset):

```ts
it("issues a challenge (hash stored, token returned once) and verifies it", async () => {
  const a = await prisma.$transaction(async (tx) => {
    await setRlsContext(ORG, tx);
    return tx.asset.create({ data: { organizationId: ORG, type: "fqdn", canonicalIdentifier: "verify.example.com" } });
  });
  const challenge = await createVerificationChallenge(ctx, a.id, "dns_txt");
  expect(challenge.method).toBe("dns_txt");
  expect(challenge.recordName).toBe("_asv-verify.verify.example.com");
  expect(challenge.token).toMatch(/^[A-Za-z0-9_-]+$/);

  // stored hash, never raw token
  const stored = await prisma.$transaction(async (tx) => {
    await setRlsContext(ORG, tx);
    return tx.assetVerification.findUnique({ where: { id: challenge.verificationId } });
  });
  expect(stored?.challengeHash).not.toContain(challenge.token);

  const verified = await verifyAssetToken(ctx, a.id, challenge.token);
  expect(verified.verificationState).toBe("verified");
  expect(verified.lifecycleState).toBe("active");
});

it("rejects a wrong or expired token", async () => {
  const a = await prisma.$transaction(async (tx) => {
    await setRlsContext(ORG, tx);
    return tx.asset.create({ data: { organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.9.9.9" } });
  });
  const challenge = await createVerificationChallenge(ctx, a.id, "manual");
  await expect(verifyAssetToken(ctx, a.id, "wrong-token")).rejects.toThrow(/invalid|expired/i);
  // expiry: backdate the challenge via admin and confirm the guard
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  await admin.query(`UPDATE "AssetVerification" SET "expiresAt" = now() - interval '1 hour' WHERE id = $1`, [challenge.verificationId]);
  await admin.end();
  await expect(verifyAssetToken(ctx, a.id, challenge.token)).rejects.toThrow(/expired/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/assets/verification.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement verification**

`portal/src/lib/assets/verification.ts`:

```ts
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";

const CHALLENGE_TTL_MS = 24 * 3600 * 1000; // challenge expires in 24h
const VERIFIED_TTL_MS = 90 * 24 * 3600 * 1000; // verification is good for 90 days

/** Issues a verification challenge. For dns_txt on an fqdn asset, the returned
 * recordName is the TXT record the customer publishes; the token is its value.
 * For manual, the customer pastes the token into the portal. Only the SHA-256
 * hash is stored. */
export async function createVerificationChallenge(
  ctx: TenantContext,
  assetId: string,
  method: "dns_txt" | "manual"
) {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const asset = await tx.asset.findFirst({ where: { id: assetId, organizationId: ctx.organizationId } });
    if (!asset) throw new Error("Asset not found");
    if (asset.lifecycleState === "retired") throw new Error("Retired assets cannot be verified");
    if (method === "dns_txt" && asset.type !== "fqdn") throw new Error("dns_txt challenges require an fqdn asset");

    const token = randomBytes(24).toString("base64url");
    const challengeHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    const verification = await tx.assetVerification.create({
      data: { organizationId: ctx.organizationId, assetId, method, status: "pending", challengeHash, expiresAt },
    });
    await tx.asset.update({ where: { id: assetId }, data: { verificationState: "pending" } });
    await recordAudit(ctx, "asset.verification-challenge", "AssetVerification", verification.id, undefined, { method }, undefined, tx);
    return {
      verificationId: verification.id,
      method,
      token,
      recordName: method === "dns_txt" ? `_asv-verify.${asset.canonicalIdentifier}` : null,
      expiresAt,
    };
  });
}

/** Verifies a pending challenge by hashing the presented token. On success the
 * asset transitions to verificationState=verified, lifecycleState=active. */
export async function verifyAssetToken(ctx: TenantContext, assetId: string, token: string) {
  if (!token) throw new Error("Verification token is required");
  const presented = createHash("sha256").update(token).digest("hex");
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const pending = await tx.assetVerification.findFirst({
      where: { assetId, organizationId: ctx.organizationId, status: "pending" },
      orderBy: { createdAt: "desc" },
    });
    if (!pending || !pending.challengeHash) throw new Error("No pending verification challenge");
    if (pending.expiresAt && pending.expiresAt < new Date()) {
      await tx.assetVerification.update({ where: { id: pending.id }, data: { status: "expired" } });
      throw new Error("Verification challenge expired");
    }
    if (pending.challengeHash !== presented) throw new Error("Invalid verification token");

    const expiresAt = new Date(Date.now() + VERIFIED_TTL_MS);
    await tx.assetVerification.update({
      where: { id: pending.id },
      data: { status: "verified", verifiedBy: ctx.userId, expiresAt },
    });
    const asset = await tx.asset.update({
      where: { id: assetId },
      data: { verificationState: "verified", lifecycleState: "active", lastSeenAt: new Date() },
    });
    await recordAudit(ctx, "asset.verify", "AssetVerification", pending.id, { status: "pending" }, { status: "verified" }, undefined, tx);
    return { verificationState: asset.verificationState, lifecycleState: asset.lifecycleState };
  });
}
```

Routes (thin wrappers):

`portal/src/app/api/v1/assets/[id]/verification-challenges/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { createVerificationChallenge } from "@/lib/assets/verification";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "asset.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const method = body?.method === "dns_txt" ? "dns_txt" : body?.method === "manual" ? "manual" : null;
  if (!method) return NextResponse.json({ error: "method must be dns_txt or manual" }, { status: 400 });
  try {
    const challenge = await createVerificationChallenge(ctx, id, method);
    return NextResponse.json(challenge, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === "Asset not found" ? 404 : 400 });
  }
}
```

`portal/src/app/api/v1/assets/[id]/verify/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { verifyAssetToken } from "@/lib/assets/verification";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "asset.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  try {
    const result = await verifyAssetToken(ctx, id, typeof body?.token === "string" ? body.token : "");
    return NextResponse.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: /expired|invalid/i.test(msg) ? 400 : 404 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/assets/verification.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run: `npx vitest run`
Expected: all green.

```bash
git add portal/src/lib/assets/verification.ts portal/src/lib/assets/verification.test.ts portal/src/app/api/v1/assets/[id]/verification-challenges portal/src/app/api/v1/assets/[id]/verify
git commit -m "feat(portal): asset verification workflow (challenges + token verify)"
```

---

## Task 9: Assets UI (list/filter/detail + import) + sidebar

**Files:**
- Modify: `portal/src/components/dashboard/sidebar.tsx`
- Create: `portal/src/app/(dashboard)/assets/page.tsx`
- Create: `portal/src/app/(dashboard)/assets/[id]/page.tsx`
- Create: `portal/src/components/dashboard/AssetTable.tsx`
- Create: `portal/src/components/dashboard/AssetImportForm.tsx`

**Interfaces:**
- Consumes: `tenantContextFromRequest` (Task 2), `listAssets`/`getAsset`/`retireAsset` (Task 5), `previewImport`/`applyImport` (Task 6), `createVerificationChallenge`/`verifyAssetToken` (Task 8), `prisma` for verification rows.

- [ ] **Step 1: Add the sidebar entry**

In `portal/src/components/dashboard/sidebar.tsx`, add to the nav array after Dashboard:

```ts
{ name: "Assets", href: "/assets" },
```

- [ ] **Step 2: Create the list page**

`portal/src/app/(dashboard)/assets/page.tsx` (server component, header-auth like the dashboard layout; the real Keycloak cookie-session UI is a known follow-up — this mirrors the current dashboard state):

```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest, setRlsContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma-client";
import { listAssets } from "@/lib/assets/service";
import { AssetTable } from "@/components/dashboard/AssetTable";
import { AssetImportForm } from "@/components/dashboard/AssetImportForm";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; lifecycleState?: string; search?: string }>;
}) {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const params = await searchParams;
  const assets = await listAssets(ctx, {
    type: params.type, lifecycleState: params.lifecycleState, search: params.search,
  });

  const importHistory = await prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    return tx.assetImport.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Assets</h1>
          <p className="text-gray-600">Canonical inventory — IPv4/IPv6/CIDR/FQDN. Retire, never delete.</p>
        </div>
        <AssetImportForm />
      </div>

      <form className="flex gap-2" method="GET">
        <input name="search" defaultValue={params.search} placeholder="Search name or identifier" className="px-3 py-2 border rounded-md text-sm" />
        <select name="type" defaultValue={params.type ?? ""} className="px-3 py-2 border rounded-md text-sm">
          <option value="">All types</option>
          <option value="ipv4">IPv4</option>
          <option value="ipv6">IPv6</option>
          <option value="cidr">CIDR</option>
          <option value="fqdn">FQDN</option>
        </select>
        <select name="lifecycleState" defaultValue={params.lifecycleState ?? ""} className="px-3 py-2 border rounded-md text-sm">
          <option value="">All states</option>
          {["draft","pending_verification","active","suspended","retiring","retired","rejected"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button className="px-3 py-2 bg-indigo-600 text-white rounded-md text-sm">Filter</button>
      </form>

      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <AssetTable assets={assets} />
      </div>

      {importHistory.length > 0 && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Recent imports</h2>
          <ul className="text-sm text-gray-700 space-y-1">
            {importHistory.map((imp) => (
              <li key={imp.id}>
                {imp.createdAt.toISOString().slice(0, 16)} — created {(imp.summary as { created?: number }).created ?? 0}, duplicates {(imp.summary as { duplicates?: number }).duplicates ?? 0}, invalid {(imp.summary as { invalid?: number }).invalid ?? 0}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the table + import form components**

`portal/src/components/dashboard/AssetTable.tsx`:

```tsx
import Link from "next/link";

export interface AssetRow {
  id: string;
  type: string;
  canonicalIdentifier: string;
  displayName: string | null;
  owner: string | null;
  environment: string | null;
  criticality: string;
  lifecycleState: string;
  verificationState: string;
}

export function AssetTable({ assets }: { assets: AssetRow[] }) {
  if (assets.length === 0) {
    return <p className="text-sm text-gray-500">No assets yet. Add one manually or import a CSV.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500 border-b">
          <th className="py-2 pr-4">Identifier</th>
          <th className="py-2 pr-4">Name</th>
          <th className="py-2 pr-4">Type</th>
          <th className="py-2 pr-4">Criticality</th>
          <th className="py-2 pr-4">Lifecycle</th>
          <th className="py-2 pr-4">Verification</th>
        </tr>
      </thead>
      <tbody>
        {assets.map((a) => (
          <tr key={a.id} className="border-b last:border-0">
            <td className="py-2 pr-4 font-mono">
              <Link href={`/assets/${a.id}`} className="text-indigo-600 hover:underline">{a.canonicalIdentifier}</Link>
            </td>
            <td className="py-2 pr-4">{a.displayName ?? "—"}</td>
            <td className="py-2 pr-4">{a.type}</td>
            <td className="py-2 pr-4">{a.criticality}</td>
            <td className="py-2 pr-4">{a.lifecycleState}</td>
            <td className="py-2 pr-4">{a.verificationState}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`portal/src/components/dashboard/AssetImportForm.tsx` (client; preview → apply with an idempotency key):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AssetImportForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<null | { rows: { row: Record<string, unknown>; status: string; errors?: string[] }[] }>(null);
  const [result, setResult] = useState<null | { summary: Record<string, number>; invalidRows: unknown[] }>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function runPreview() {
    setBusy(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/v1/assets/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreview(data.preview);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function apply() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/v1/assets/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data);
      setPreview(null);
      setCsv("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium">+ Import CSV</button>
      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900">Import assets</h3>
            <p className="text-sm text-gray-500 mb-3">Columns: type (ipv4|ipv6|cidr|fqdn), identifier, display_name, owner, environment, criticality</p>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} className="w-full px-3 py-2 border rounded-md text-sm font-mono" placeholder={"type,identifier,display_name\nipv4,10.0.0.1,web"} />
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

            {preview && (
              <div className="mt-3 max-h-60 overflow-auto border rounded-md p-3 text-sm">
                {preview.rows.map((r, i) => (
                  <div key={i} className={r.status === "invalid" ? "text-red-600" : r.status === "duplicate" ? "text-amber-600" : "text-green-700"}>
                    {r.status.toUpperCase()} — {String(r.row.identifier)} {r.errors?.length ? `(${r.errors.join("; ")})` : ""}
                  </div>
                ))}
              </div>
            )}

            {result && (
              <div className="mt-3 text-sm">
                <p>Created {result.summary.created}, duplicates {result.summary.duplicates}, invalid {result.summary.invalid}</p>
                {result.invalidRows.length > 0 && (
                  <pre className="mt-2 p-2 bg-gray-50 border rounded text-xs overflow-auto">{JSON.stringify(result.invalidRows, null, 2)}</pre>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setOpen(false)} className="px-4 py-2 border rounded-md text-sm">Close</button>
              {!preview && !result && (
                <button onClick={runPreview} disabled={busy || !csv.trim()} className="px-4 py-2 bg-gray-700 text-white rounded-md text-sm disabled:opacity-50">Preview</button>
              )}
              {preview && (
                <button onClick={apply} disabled={busy} className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm">Import valid rows</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Create the detail page**

`portal/src/app/(dashboard)/assets/[id]/page.tsx` (server component; shows asset + verification actions):

```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest, setRlsContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma-client";
import { getAsset } from "@/lib/assets/service";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const { id } = await params;
  const asset = await getAsset(ctx, id);
  if (!asset) return <p className="p-8 text-gray-500">Asset not found.</p>;

  const verifications = await prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    return tx.assetVerification.findMany({ where: { assetId: id }, orderBy: { createdAt: "desc" } });
  });

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">{asset.displayName ?? asset.canonicalIdentifier}</h1>
      <dl className="bg-white rounded-lg shadow border p-6 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-gray-500">Identifier</dt><dd className="font-mono">{asset.canonicalIdentifier}</dd></div>
        <div><dt className="text-gray-500">Type</dt><dd>{asset.type}</dd></div>
        <div><dt className="text-gray-500">Owner</dt><dd>{asset.owner ?? "—"}</dd></div>
        <div><dt className="text-gray-500">Environment</dt><dd>{asset.environment ?? "—"}</dd></div>
        <div><dt className="text-gray-500">Criticality</dt><dd>{asset.criticality}</dd></div>
        <div><dt className="text-gray-500">Lifecycle</dt><dd>{asset.lifecycleState}</dd></div>
        <div><dt className="text-gray-500">Verification</dt><dd>{asset.verificationState}</dd></div>
        <div><dt className="text-gray-500">Source</dt><dd>{asset.source}</dd></div>
      </dl>

      <div className="bg-white rounded-lg shadow border p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Verification history</h2>
        {verifications.length === 0 ? (
          <p className="text-sm text-gray-500">No verification attempts.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {verifications.map((v) => (
              <li key={v.id}>{v.method} — {v.status}{v.verifiedBy ? ` by ${v.verifiedBy}` : ""} {v.expiresAt ? `(expires ${v.expiresAt.toISOString().slice(0, 10)})` : ""}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify the build**

Run: `APP_MODE=prod npx next build`
Expected: build succeeds (catches TS/import errors across the new pages/components).

- [ ] **Step 6: Commit**

```bash
git add portal/src/components/dashboard/sidebar.tsx portal/src/app/'(dashboard)'/assets portal/src/components/dashboard/AssetTable.tsx portal/src/components/dashboard/AssetImportForm.tsx
git commit -m "feat(portal): assets UI (list/filter, detail, CSV import)"
```

---

## Task 10: Phase 2 exit-criterion tests + full verification

**Files:**
- Create: `portal/src/lib/assets/phase2-exit.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4-8.

**Purpose:** Prove the Phase 2 exit criterion from the spec §10 / design §11: *imports are idempotent; invalid rows are downloadable; duplicates do not create extra assets; retiring referenced assets preserves history.*

- [ ] **Step 1: Write the exit test**

`portal/src/lib/assets/phase2-exit.test.ts` (fixed ids + admin wipe, mirror service.test.ts):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { parseCsv, applyImport, getImportResult } from "@/lib/assets/import";
import { retireAsset, listAssets, getAsset } from "@/lib/assets/service";
import { createVerificationChallenge, verifyAssetToken } from "@/lib/assets/verification";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_exit_0001";
const USER = "user_exit_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "asset_manager", isStaff: false, appMode: "dev" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    await admin.query(`DELETE FROM "AssetVerification" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "AssetImport" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("Phase 2 exit criteria", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Exit Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-exit", email: "exit@x.com" } });
    });
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("imports are idempotent: same key + same file never creates extra assets", async () => {
    const csv = `type,identifier,display_name\nipv4,10.1.0.1,a\nfqdn,one.example.com,b\n`;
    const rows = parseCsv(csv);
    const first = await applyImport(ctx, rows, "exit-imp-1");
    const second = await applyImport(ctx, rows, "exit-imp-1");
    expect(second.importId).toBe(first.importId);
    const count = await withTenant(ORG, (tx) => tx.asset.count());
    expect(count).toBe(2);
  });

  it("invalid rows are downloadable via the import result", async () => {
    const csv = `type,identifier\nipv4,10.2.0.1\nfqdn,-bad.example.com\n`;
    const rows = parseCsv(csv);
    const result = await applyImport(ctx, rows, "exit-imp-2");
    expect(result.summary.created).toBe(1);
    expect(result.summary.invalid).toBe(1);
    const stored = await getImportResult(ctx, result.importId);
    expect(stored?.invalidRows).toHaveLength(1);
    expect(JSON.stringify(stored?.invalidRows)).toMatch(/-bad\.example\.com/);
  });

  it("duplicates do not create extra assets (manual + import)", async () => {
    const csv = `type,identifier\nipv4,10.3.0.1\nipv4,10.3.0.1\n`;
    const rows = parseCsv(csv);
    const result = await applyImport(ctx, rows, "exit-imp-3");
    // second identical row is a within-file duplicate
    expect(result.summary.created).toBe(1);
    expect(result.summary.duplicates).toBe(1);
  });

  it("retiring referenced assets preserves history (row + audit + verification)", async () => {
    const a = await withTenant(ORG, async (tx) => tx.asset.create({
      data: { organizationId: ORG, type: "fqdn", canonicalIdentifier: "retire.example.com" },
    }));
    const challenge = await createVerificationChallenge(ctx, a.id, "dns_txt");
    await verifyAssetToken(ctx, a.id, challenge.token);
    await retireAsset(ctx, a.id);

    const after = await getAsset(ctx, a.id);
    expect(after?.lifecycleState).toBe("retired");
    expect(after?.id).toBe(a.id); // row preserved

    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { resourceId: a.id }, orderBy: { createdAt: "asc" } }));
    expect(audits.map((e) => e.action)).toEqual(["asset.create", "asset.verification-challenge", "asset.verify", "asset.retire"]);

    const verifications = await withTenant(ORG, (tx) => tx.assetVerification.findMany({ where: { assetId: a.id } }));
    expect(verifications.length).toBeGreaterThanOrEqual(1);
  });

  it("cross-tenant isolation holds for assets (RLS)", async () => {
    const other = "org_exit_foreign_9999";
    await withTenant(other, async (tx) => { await tx.organization.create({ data: { id: other, name: "F" } }); });
    const foreignAsset = await prisma.$transaction(async (tx) => {
      await setRlsContext(other, tx);
      return tx.asset.create({ data: { organizationId: other, type: "ipv4", canonicalIdentifier: "8.8.8.8" } });
    });
    expect(await getAsset(ctx, foreignAsset.id)).toBeNull();
    const all = await listAssets(ctx, {});
    expect(all.every((x) => x.organizationId === ORG)).toBe(true);
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
    await admin.connect();
    await admin.query(`DELETE FROM "Asset" WHERE "organizationId" = $1`, [other]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [other]);
    await admin.end();
  });
});
```

- [ ] **Step 2: Run the exit test**

Run: `npx vitest run src/lib/assets/phase2-exit.test.ts`
Expected: PASS.

- [ ] **Step 3: Full suite + fresh state verification**

Run: `npx vitest run`
Expected: all green.

Run: `git status --short` and confirm the working tree contains only intended Phase 2 changes.
Run: `git log --oneline -5` and confirm the Phase 2 commit trail.

- [ ] **Step 4: Commit**

```bash
git add portal/src/lib/assets/phase2-exit.test.ts
git commit -m "test(portal): Phase 2 exit criteria (idempotent import, invalid rows, dedupe, retire preserves history)"
```

- [ ] **Step 5: Update AGENTS.md project state**

In `portal/../AGENTS.md`, update the verified state: Phase 2 DONE (asset inventory — models, normalization, CSV import w/ preview + downloadable invalid rows, dedupe, lifecycle/retire, DNS/manual verification, API routes, assets UI, ApiKey RLS revival). Update the test count from the fresh `npx vitest run` output. Move the ApiKey follow-up out of "Known follow-ups".

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md — Phase 2 complete (asset inventory), refreshed test count"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** §10 Phase 2 exit (Task 10), §4 Asset/AssetVerification models (Task 3), §3 RLS pattern (Tasks 1, 3), §8 API shape: `GET/POST /v1/assets` (Task 7), `POST /v1/assets/imports` + `GET /v1/assets/imports/{id}` (Tasks 6-7), `PATCH /v1/assets/{id}` (Task 7), `POST /v1/assets/{id}/verification-challenges` (Task 8), `POST /v1/assets/{id}/retire` (Task 7). Design §11 Phase 2 build list: canonical assets (T3/T5), normalization (T4), CSV preview/import (T6), duplicate detection (T5/T6), lifecycle (T5), ownership contacts (`owner` field, T5/T9), list/filter/detail UI (T9), verification workflow (T8). AGENTS.md "Phase 2 FIRST task" ApiKey revival (T1/T2). §12 MVP boundary: IPv4/IPv6/CIDR/FQDN + manual and CSV creation + DNS/manual verification (T4-T9).
- **Placeholder scan:** none — every task carries concrete code and exact run commands. The `[id]/route.ts` GET uses a local helper `listKeysFor` defined inline in the same file to avoid a spurious shared module.
- **Type consistency:** `TenantContext` from `@/lib/tenant` throughout; `recordAudit` gained an optional `tx` (Task 1) used by Tasks 1, 5, 6, 8; `normalizeIdentifier(type, raw)` signature matches across Tasks 4-6; `DuplicateAssetError` defined in Task 5, caught in Task 6 and mapped to 409 in Task 7; `isScope` defined in Task 1 (requireScope.ts), used in Task 2 routes. `applyImport` returns `{ importId, summary, invalidRows }` consistently with `getImportResult`'s record shape. Route `params` are awaited Promises (Next 16) in every `[id]` route.
- **Known deferrals kept out of scope:** no legacy `Customer.scope_ips` data migration (owner directive); `asset_addresses`/`asset_relationships`/`asset_observations` and reconciliation are Phase 5; scope/scan wiring is Phases 3-4; real DNS TXT fetch is a deployment concern (the token IS the TXT value — the mechanism is complete); cookie-session UI auth remains the known follow-up; openapi.yaml updates deferred (secret-scanner landmine).
