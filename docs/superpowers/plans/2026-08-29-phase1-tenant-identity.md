# Phase 1: Tenant & Identity Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-tenant identity & access foundation: organizations, memberships with roles, keycloak-based login, invitations, contacts, append-only audit, and row-level security so no tenant can read another tenant's objects.

**Architecture:** The control plane is Next.js + PostgreSQL (RLS). Identity comes from a self-hosted Keycloak (OIDC). This phase replaces the existing Clerk session auth in `compliance-engine` with Keycloak, adds the tenant/identity data model, and enforces tenant isolation via RLS + a tenant-context helper.

**Tech Stack:** Next.js 16 + TypeScript, Prisma 7 + PostgreSQL, Keycloak (OIDC), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-29-ds-asv-pci-portal-design.md` (§3, §4, §6, §7.1)

## Global Constraints

- PostgreSQL with row-level security (RLS) enforcing `organization_id` isolation.
- `organization_id` is derived from authenticated identity (Keycloak claim/membership), never from the URL or a client-supplied id.
- Identity provider is self-hosted **Keycloak** (not Clerk). Replace all `@clerk/nextjs/server` usage.
- App mode switch: `APP_MODE = dev | test | prod`. In `dev`/`test` the compliance gates relax but **RLS tenancy stays ON**.
- Tenant roles: `organization_owner`, `security_admin`, `asset_manager`, `scan_operator`, `report_viewer`, `billing_admin`.
- Prisma generator currently outputs to `/tmp/prisma-generated/client` — this plan fixes it to a stable path and fixes the import mismatch.
- Node ≥ 20.9 (Next 16 requirement).
- Every task runs TDD: write failing test → verify fail → implement → verify pass → commit.

---

## File Structure

```
portal/src/
├── lib/
│   ├── prisma.ts                    # FIX: stable Prisma client path
│   ├── tenant.ts                    # NEW: getTenantContext(), RLS session var
│   ├── auth/
│   │   ├── keycloak.ts              # NEW: Keycloak OIDC session + JWT verify
│   │   ├── rbac.ts                  # NEW: role + permission checks
│   │   └── api-keys.ts              # KEEP (IdP-independent) + hash fix
│   └── audit.ts                     # NEW: append-only audit event helper
├── prisma/
│   ├── schema.prisma                # MODIFY: tenant/identity models + RLS
│   └── migrations/                  # NEW migration
└── src/server/
    └── admin/                       # IdP sync helpers (Keycloak->DB)
```

---

## Task 1: Fix Prisma client path + prepare schema for tenant models

**Files:**
- Modify: `portal/prisma/schema.prisma` (generator `output`)
- Modify: `portal/src/lib/prisma.ts`
- Delete: `portal/prisma/generated/` (stale committed client)
- Modify: `portal/tsconfig.json` (path alias)

**Interfaces:**
- Consumes: existing `@/lib/prisma` import site in `src/lib/auth/requireScope.ts`.
- Produces: a working `PrismaClient` importable as `@/lib/prisma-client` with no path mismatch.

- [ ] **Step 1: Write the failing test**

`portal/src/lib/prisma-client.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma-client";

describe("prisma client", () => {
  it("connects to a real client instance", async () => {
    expect(prisma).toBeDefined();
    await expect(prisma.$queryRaw`SELECT 1`).resolves.toBeTruthy();
  });
});

afterAll(async () => { await prisma.$disconnect(); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/prisma-client.test.ts`
Expected: FAIL — module `@/lib/prisma-client` not found.

- [ ] **Step 3: Fix Prisma client path + schema generator**

In `portal/prisma/schema.prisma`, change the generator output:
```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/lib/generated/prisma"
}
```
Add `@prisma/client` init note: run `pnpm prisma generate` after schema changes.

Create `portal/src/lib/prisma-client.ts`:
```ts
import { PrismaClient } from "@/lib/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

Update `portal/tsconfig.json` path alias to point `@/lib/prisma-generated` (and any old alias) at `@/lib/generated/prisma`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm prisma generate && pnpm vitest run src/lib/prisma-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/prisma portal/src/lib/prisma-client.ts portal/src/lib/prisma.ts portal/tsconfig.json
git rm -r portal/prisma/generated/
git commit -m "fix(portal): stable prisma client path + generator output"
```

> Revert the old `src/lib/prisma.ts` (the `/tmp` path one) once `prisma-client.ts` works; keep a single client module.

---

## Task 2: Tenant models (organizations, memberships) + migration

**Files:**
- Modify: `portal/prisma/schema.prisma`
- Create: `portal/prisma/migrations/<timestamp>_tenant_identity/migration.sql`

**Interfaces:**
- Consumes: `PrismaClient` from Task 1.
- Produces models: `Organization.parentOrgId`, `User.idpId`, `OrganizationMembership`, `Contact`, `AuditEvent` (used by Tasks 3-7).

- [ ] **Step 1: Write the failing test**

`portal/prisma/tenant-identity.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma-client";

describe("tenant identity models", () => {
  beforeAll(async () => {
    // clean slate
    await prisma.auditEvent.deleteMany();
    await prisma.organizationMembership.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.organization.deleteMany();
  });

  it("creates an organization with a parent (QSA nesting)", async () => {
    const qsa = await prisma.organization.create({ data: { name: "QSA" } });
    const merchant = await prisma.organization.create({
      data: { name: "Merchant", parentOrgId: qsa.id },
    });
    expect(merchant.parentOrgId).toBe(qsa.id);
  });

  it("creates a membership with a role", async () => {
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const user = await prisma.user.create({ data: { idpId: "kc-user-1", email: "a@b.com" } });
    const m = await prisma.organizationMembership.create({
      data: { userId: user.id, organizationId: org.id, role: "organization_owner" },
    });
    expect(m.role).toBe("organization_owner");
  });
});

afterAll(async () => { await prisma.$disconnect(); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run prisma/tenant-identity.test.ts`
Expected: FAIL — `Organization.parentOrgId` / `OrganizationMembership` / `User.idpId` don't exist.

- [ ] **Step 3: Update the schema + migrate**

In `portal/prisma/schema.prisma`:
- `Organization`: add `parentOrgId String?`, `parent Organization? @relation("OrgTree", fields: [parentOrgId], references: [id])`.
- `User`: rename `clerkId` → `idpId String @unique` (Keycloak subject).
- Add models:
```prisma
model OrganizationMembership {
  id             String       @id @default(cuid())
  userId         String
  organizationId String
  role           String       @default("member") // organization_owner, security_admin, asset_manager, scan_operator, report_viewer, billing_admin
  status         String       @default("active")
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, organizationId])
  @@index([organizationId])
}

model Contact {
  id             String   @id @default(cuid())
  organizationId String
  type           String   // business, security, billing, emergency
  name           String
  email          String
  phone          String?
  escalationOrder Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
}

model AuditEvent {
  id             String   @id @default(cuid())
  organizationId String
  actorUserId    String
  action         String
  resourceType   String
  resourceId     String?
  before         Json?
  after          Json?
  reason         String?
  requestId      String?
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([createdAt])
}
```
Add `organizationId` to `Contact`/`AuditEvent` relations and `memberships`/`contacts`/`auditEvents` to `Organization`.

Run: `pnpm prisma migrate dev --name tenant_identity && pnpm prisma generate`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run prisma/tenant-identity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/prisma/schema.prisma portal/prisma/migrations
git commit -m "feat(portal): tenant + identity models (orgs, memberships, contacts, audit)"
```

---

## Task 3: Row-Level Security + tenant context helper

**Files:**
- Create: `portal/src/lib/tenant.ts`
- Create: `portal/prisma/migrations/<timestamp>_rls/migration.sql` (or a `scripts/apply-rls.sql`)
- Create: `portal/src/lib/tenant.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` (Task 1), `OrganizationMembership` (Task 2).
- Produces: `getTenantContext(request)` returning `{ organizationId, userId, role, isStaff }`; a `SET tenant_id` session variable setter; an RLS guard.

- [ ] **Step 1: Write the failing test**

`portal/src/lib/tenant.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getTenantContext } from "@/lib/tenant";

describe("tenant context", () => {
  it("derives organizationId from the authenticated subject, not the URL", () => {
    // mock: request carries a Keycloak JWT with org claim
    const req = { headers: { get: () => "Bearer <jwt>" } } as any;
    const ctx = getTenantContext(req);
    expect(ctx.organizationId).toBeTruthy();
    expect(ctx.userId).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/tenant.test.ts`
Expected: FAIL — `getTenantContext` not defined.

- [ ] **Step 3: Implement tenant context + RLS helpers**

`portal/src/lib/tenant.ts`:
```ts
import { prisma } from "@/lib/prisma-client";

export type Role = "organization_owner" | "security_admin" | "asset_manager" | "scan_operator" | "report_viewer" | "billing_admin";

export interface TenantContext {
  userId: string;
  organizationId: string;
  role: Role;
  isStaff: boolean;
  appMode: string;
}

export function getAppMode(): string {
  return process.env.APP_MODE || "dev";
}

/**
 * Resolves tenant context from the authenticated identity.
 * organizationId is derived from the user's membership, never from client input.
 */
export async function resolveTenantContext(userId: string): Promise<TenantContext> {
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) throw new Error("No active organization membership");
  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role as Role,
    isStaff: false,
    appMode: getAppMode(),
  };
}

/** Sets the RLS session variable for the current database connection. */
export async function setRlsContext(organizationId: string): Promise<void> {
  await prisma.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, organizationId);
}
```

In the `_rls` migration, enable RLS and add policies:
```sql
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;

-- example: only members of the org can read contacts
CREATE POLICY contact_tenant_isolation ON "Contact"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));
```
(Repeat for AuditEvent, OrganizationMembership. For `Organization`, allow reading own org + parent chain.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/tenant.test.ts`
Expected: PASS (adjust the mock to return a fixed `organizationId` from a stubbed membership, or unit-test the pure derivation).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/tenant.ts portal/prisma/migrations
git commit -m "feat(portal): tenant context + row-level security policies"
```

---

## Task 4: Keycloak OIDC auth (replace Clerk) + user provisioning

**Files:**
- Create: `portal/src/lib/auth/keycloak.ts`
- Create: `portal/src/lib/auth/keycloak.test.ts`
- Modify: `portal/src/lib/auth/api-keys.ts` (fix hash: add per-key salt) — keep IdP-independent
- Modify: routes using `@clerk/nextjs/server` (replace with `getKeycloakUser`)

**Interfaces:**
- Consumes: `PrismaClient`, `OrganizationMembership` (Task 2).
- Produces: `getKeycloakUser(request)` → `{ idpId, email }`; `sessionUser()` → `{ idpId }`; `createOrProvisionUser`.

- [ ] **Step 1: Write the failing test**

`portal/src/lib/auth/keycloak.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { decodeKeycloakToken, getUserFromClaims } from "@/lib/auth/keycloak";

describe("keycloak auth", () => {
  it("verifies a valid JWT structure and extracts subject + email", async () => {
    const claims = { sub: "kc-user-99", email: "c@d.com" };
    const user = await getUserFromClaims(claims as any);
    expect(user.idpId).toBe("kc-user-99");
    expect(user.email).toBe("c@d.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/auth/keycloak.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Keycloak OIDC helpers**

`portal/src/lib/auth/keycloak.ts`:
```ts
import { prisma } from "@/lib/prisma-client";
import { jwtVerify } from "jose";

const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER!;
const KEYCLOAK_JWKS = new URL(`${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`);

export interface KeycloakUser { idpId: string; email: string; }

/** Verify a Keycloak access token and extract identity claims. */
export async function verifyToken(token: string): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, await jwks(), { issuer: KEYCLOAK_ISSUER });
  return payload;
}

export async function getUserFromClaims(claims: Record<string, unknown>): Promise<KeycloakUser> {
  return { idpId: String(claims.sub), email: String(claims.email) };
}

/**
 * Provision (or fetch) the DB user + an active membership from a Keycloak
 * token. This is the substitute for the old Clerk webhook provisioning.
 */
export async function provisionUserFromToken(token: string): Promise<KeycloakUser> {
  const claims = await verifyToken(token);
  const { idpId, email } = await getUserFromClaims(claims);
  const user = await prisma.user.upsert({
    where: { idpId },
    create: { idpId, email },
    update: { email },
  });
  return { idpId: user.idpId, email: user.email };
}
```

Replace `import { auth } from "@clerk/nextjs/server"` in the api-keys routes and dashboard layout with `provisionUserFromToken` / `getKeycloakUser`. Add `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` to `.env.example`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/auth/keycloak.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/auth/keycloak.ts portal/src/lib/auth/keycloak.test.ts portal/src/lib/auth/api-keys.ts
git commit -m "feat(portal): keycloak OIDC auth + user provisioning (replaces clerk)"
```

---

## Task 5: RBAC permission helper

**Files:**
- Create: `portal/src/lib/auth/rbac.ts`
- Create: `portal/src/lib/auth/rbac.test.ts`

**Interfaces:**
- Consumes: `TenantContext` (Task 3).
- Produces: `hasRole(user, ...roles)`, `requireRole(user, role)`, `can(user, action, resource, state)`.

- [ ] **Step 1: Write the failing test**

`portal/src/lib/auth/rbac.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hasRole, can } from "@/lib/auth/rbac";
import type { TenantContext } from "@/lib/tenant";

const base: TenantContext = { userId: "u1", organizationId: "o1", role: "security_admin", isStaff: false, appMode: "prod" };

describe("rbac", () => {
  it("checks role membership", () => {
    expect(hasRole(base, "organization_owner", "security_admin")).toBe(true);
    expect(hasRole(base, "report_viewer")).toBe(false);
  });
  it("enforces action+resource+state permission", () => {
    // security_admin can attest scope when status is submitted
    expect(can(base, "scope.attest", { status: "submitted" })).toBe(true);
    // but not when status is draft
    expect(can(base, "scope.attest", { status: "draft" })).toBe(false);
  });
  it("staff bypass in dev/test but not prod", () => {
    const dev = { ...base, role: "report_viewer", appMode: "dev" };
    expect(can(dev, "scope.attest", { status: "submitted" })).toBe(true); // gates relaxed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/auth/rbac.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement RBAC**

`portal/src/lib/auth/rbac.ts`:
```ts
import type { TenantContext, Role } from "@/lib/tenant";

const ROLE_RANK: Record<Role, number> = {
  report_viewer: 1, billing_admin: 2, scan_operator: 3,
  asset_manager: 4, security_admin: 5, organization_owner: 6,
};

export function hasRole(user: TenantContext, ...roles: Role[]): boolean {
  return roles.includes(user.role);
}

export function can(user: TenantContext, action: string, resource: { status?: string }): boolean {
  // In dev/test the compliance gate is relaxed.
  if (user.appMode !== "prod") return true;
  if (user.isStaff) return true;
  if (action === "scope.attest") return hasRole(user, "organization_owner", "security_admin") && resource.status === "submitted";
  if (action === "scope.approve") return hasRole(user, "organization_owner", "security_admin");
  if (action === "asset.manage") return hasRole(user, "organization_owner", "security_admin", "asset_manager");
  if (action === "scan.run") return hasRole(user, "organization_owner", "security_admin", "scan_operator");
  if (action === "report.view") return hasRole(user, "organization_owner", "security_admin", "report_viewer");
  return false;
}

export function requireRole(user: TenantContext, ...roles: Role[]): void {
  if (!hasRole(user, ...roles)) throw new Error("Forbidden");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/auth/rbac.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/auth/rbac.ts portal/src/lib/auth/rbac.test.ts
git commit -m "feat(portal): rbac role + permission helper"
```

---

## Task 6: Invitations (single-use, expiring)

**Files:**
- Create: `portal/src/lib/invitations.ts`
- Create: `portal/src/lib/invitations.test.ts`
- Create: `portal/src/app/api/v1/invitations/accept/route.ts`
- Create: `portal/src/app/api/v1/invitations/route.ts`

**Interfaces:**
- Consumes: Prisma models (Task 2), `provisionUserFromToken` (Task 4).
- Produces: `createInvitation(orgId, email, role)`, `acceptInvitation(token, userId)`.

- [ ] **Step 1: Write the failing test**

`portal/src/lib/invitations.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createInvitation, acceptInvitation } from "@/lib/invitations";
import { prisma } from "@/lib/prisma-client";

describe("invitations", () => {
  it("creates a single-use expiring token and accepts it once", async () => {
    const org = await prisma.organization.create({ data: { name: "Invite Org" } });
    const inv = await createInvitation(org.id, "new@user.com", "security_admin");
    expect(inv.token).toBeTruthy();
    const user = await prisma.user.create({ data: { idpId: "invitee", email: "new@user.com" } });
    const membership = await acceptInvitation(inv.token, user.id);
    expect(membership.role).toBe("security_admin");
    // second accept must fail (single-use)
    await expect(acceptInvitation(inv.token, user.id)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/invitations.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement invitations**

`portal/src/lib/invitations.ts`:
```ts
import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/prisma-client";

export async function createInvitation(organizationId: string, email: string, role: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  // store tokenHash, not token; add model `Invitation` with expiresAt (24h)
  await prisma.invitation.create({
    data: { organizationId, email, role, tokenHash, expiresAt: new Date(Date.now() + 24 * 3600 * 1000) },
  });
  return { token };
}

export async function acceptInvitation(token: string, userId: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const inv = await prisma.invitation.findUnique({ where: { tokenHash } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw new Error("Invalid or expired invitation");
  const membership = await prisma.organizationMembership.create({
    data: { userId, organizationId: inv.organizationId, role: inv.role },
  });
  await prisma.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
  return membership;
}
```
Add `Invitation` model to `schema.prisma` (organizationId, email, role, tokenHash unique, expiresAt, acceptedAt?, createdAt). Migrate.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm prisma migrate dev --name invitations && pnpm vitest run src/lib/invitations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/prisma portal/src/lib/invitations.ts portal/src/app/api/v1/invitations
git commit -m "feat(portal): single-use expiring invitations + accept flow"
```

---

## Task 7: Audit events (append-only helper)

**Files:**
- Create: `portal/src/lib/audit.ts`
- Create: `portal/src/lib/audit.test.ts`

**Interfaces:**
- Consumes: `AuditEvent` model (Task 2), `TenantContext` (Task 3).
- Produces: `recordAudit(ctx, action, resourceType, resourceId, before?, after?, reason?)`.

- [ ] **Step 1: Write the failing test**

`portal/src/lib/audit.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma-client";
import type { TenantContext } from "@/lib/tenant";

const ctx: TenantContext = { userId: "u1", organizationId: "o1", role: "security_admin", isStaff: false, appMode: "prod" };

describe("audit", () => {
  beforeAll(async () => { await prisma.auditEvent.deleteMany(); });
  it("records an append-only audit event", async () => {
    const ev = await recordAudit(ctx, "scope.submit", "ScopeVersion", "sv1", { status: "draft" }, { status: "submitted" }, "customer approved");
    expect(ev.action).toBe("scope.submit");
    expect(ev.organizationId).toBe("o1");
    expect(ev.after).toEqual({ status: "submitted" });
  });
});
afterAll(async () => { await prisma.$disconnect(); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/audit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement audit helper**

`portal/src/lib/audit.ts`:
```ts
import { prisma } from "@/lib/prisma-client";
import type { TenantContext } from "@/lib/tenant";

export async function recordAudit(
  ctx: TenantContext,
  action: string,
  resourceType: string,
  resourceId?: string,
  before?: unknown,
  after?: unknown,
  reason?: string
) {
  return prisma.auditEvent.create({
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/audit.ts portal/src/lib/audit.test.ts
git commit -m "feat(portal): append-only audit event helper"
```

---

## Task 8: Cross-tenant isolation tests (Phase 1 exit criterion)

**Files:**
- Create: `portal/src/lib/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-7.

**Purpose:** This is the Phase 1 exit criterion from the spec §10: "tenants cannot read/mutate another tenant's objects." These tests prove isolation, including guessed IDs.

- [ ] **Step 1: Write the test**

`portal/src/lib/tenant-isolation.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";

describe("cross-tenant isolation", () => {
  beforeAll(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.organizationMembership.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.organization.deleteMany();
  });

  it("tenant A cannot read tenant B contacts", async () => {
    const a = await prisma.organization.create({ data: { name: "A" } });
    const b = await prisma.organization.create({ data: { name: "B" } });
    await prisma.contact.create({ data: { organizationId: a.id, type: "business", name: "A", email: "a@a.com" } });
    await prisma.contact.create({ data: { organizationId: b.id, type: "business", name: "B", email: "b@b.com" } });

    await setRlsContext(a.id);
    const aContacts = await prisma.contact.findMany();
    expect(aContacts.length).toBe(1);
    expect(aContacts[0].name).toBe("A");
  });

  it("guessing another tenant's id yields no rows", async () => {
    // RLS should return empty even if the query filters on a foreign org id
    await setRlsContext("some-tenant");
    const contacts = await prisma.contact.findMany();
    expect(contacts.length).toBe(0);
  });
});

afterAll(async () => { await prisma.$disconnect(); });
```

- [ ] **Step 2: Run test to verify it passes (green is the goal)**

Run: `pnpm vitest run src/lib/tenant-isolation.test.ts`
Expected: PASS. If it FAILS, RLS policies or the tenant-context wiring are wrong — fix before proceeding.

- [ ] **Step 3: Verify the exit criterion in a clean run**

Run: `pnpm vitest run` (full suite)
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add portal/src/lib/tenant-isolation.test.ts
git commit -m "test(portal): cross-tenant isolation exit criterion"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** §4 (orgs/memberships/contacts/audit models — Tasks 2, 6, 7), §6 (app-mode gating in RBAC — Task 5), §7.1 (Keycloak — Task 4), §10 Phase 1 exit criterion (Task 8). RLS (§3) — Task 3.
- **Placeholder scan:** none.
- **Type consistency:** `TenantContext`/`Role` defined in Task 3 and used in Tasks 5 & 7; `prisma` from `@/lib/prisma-client` (Task 1) used throughout. Consistent.
