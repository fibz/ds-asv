# User Center Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **user center hub** — org profile & settings, team management (members, roles, invites), access & sessions (record, list, revoke), API keys, and audit trail — behind a **stable, versioned API contract** plus a functional UI baseline, so other modules (scans, reports, Wazuh, WAF) and other teams build against the contract instead of the codebase.

**Architecture:** The portal (Next.js + PostgreSQL RLS) remains the control plane. The user center is a **bounded module**: new `lib/org/*` services, new `/api/v1/{org,team,sessions,audit}` routes, one new tenant table (`Session` — the access registry), and a functional UI under `/settings`, `/team`, `/access`, `/audit`. The API contract (`portal/spec/openapi.yaml`) is extended **first** and is the handoff artifact for the UI stream (Codex or a human UI dev). The scanner service (FastAPI) and future integrations plug into the same contract. Session tokens are hashed (sha256) — raw tokens are never stored; revoking a session blocks that token on the next authenticated request.

**Tech Stack:** Next.js 16 + TypeScript, Prisma 7 + PostgreSQL (RLS), Keycloak OIDC (Bearer JWT), Tailwind v4, vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-ds-asv-pci-portal-design.md` (§1.1 Customer Management Center core, §2 control-plane ownership of orgs/memberships/sessions, §3 memberships + roles + QSA nesting, §4 models, §7.1 Keycloak session IdP). User directive (2026-08-31): user center is the **hub** other projects build around — plumbing + contract first, UI handed off.

## Global Constraints

- PostgreSQL RLS enforces `organizationId` isolation on **every** tenant table; `organizationId` is derived from authenticated identity (`tenantContextFromRequest`), never from the URL or client input.
- **Every migration adding a tenant table must ENABLE RLS + create policies + GRANT `asv_app` in the SAME migration** (fail-closed pattern from `20260829142337_rls_hardening` / `20260830000002_phase2_assets`).
- App connects as `asv_app` (fail-closed grants); admin/test setup/cleanup uses a second `pg.Client` from `ADMIN_DATABASE_URL` with **scoped wipes by fixed ids only — never global DELETEs** (parallel vitest workers share one DB).
- `set_config('app.tenant_id', ...)` is **transaction-scoped** — bind RLS context inside `prisma.$transaction` with the tx client (`withTenant(orgId, fn)` helper).
- **Prisma 7 workflow:** never `migrate dev`. Use `npx prisma migrate diff --from-url $ADMIN_DATABASE_URL --to-schema prisma/schema.prisma` (shadow DB `asv_shadow` wired via `datasource.shadowDatabaseUrl` in `prisma.config.ts`), create the migration dir, **append RLS/grants SQL**, `npx prisma migrate deploy`, `npx prisma generate`. After any diff, verify no partial unique index was dropped (none are added here, but check).
- **Test command:** `npx --cache /home/cchock/projects/.npm-cache vitest run` in `portal/`. Tests must pass with `APP_MODE=dev`/unset for RLS-only paths; route tests that assert role gating **stub `APP_MODE=prod`** (`vi.stubEnv("APP_MODE","prod")`) because `can()` relaxes outside prod.
- Roles: `organization_owner`, `security_admin`, `asset_manager`, `scan_operator`, `report_viewer`, `billing_admin`.
- Audit writes go through `recordAudit(ctx, action, resourceType, resourceId?, before?, after?, reason?, tx?)` only (append-only, no update/delete path).
- **No hard deletes of tenant data** — sessions are *revoked* (`revokedAt`), members are *removed from the membership* (the `User` row and audit history persist).
- Session identity: `tokenHash = sha256(hex)` of the raw Bearer token (one JWT = one session). Raw tokens are never stored or logged.
- Contract-first: `portal/spec/openapi.yaml` is the source of truth for user-center routes; Task 11 enforces spec ↔ route conformance.
- Node ≥ 20.9. Every task is TDD: failing test → verify fail → implement → verify pass → commit.

---

## File Structure

```
portal/src/
├── lib/
│   ├── auth/rbac.ts                  # MODIFY: org.* / team.* / session.* / audit.* actions
│   ├── tenant.ts                     # MODIFY: session block + record in tenantContextFromRequest
│   ├── audit.ts                      # MODIFY: add listAuditEvents (org-scoped read)
│   └── org/                          # NEW: user center module
│       ├── sessions.ts               # NEW: session registry service (+ token hash)
│       ├── sessions.test.ts          # NEW
│       ├── profile.ts                # NEW: org profile + contacts service
│       ├── profile.test.ts           # NEW
│       ├── team.ts                   # NEW: members/roles service + guards
│       ├── team.test.ts              # NEW
│       └── exit.test.ts              # NEW: user center exit criteria
├── prisma/
│   ├── schema.prisma                 # MODIFY: Session model (+ User/Organization relations)
│   └── migrations/<ts>_user_center_sessions/migration.sql   # NEW (+RLS+GRANT)
├── spec/openapi.yaml                 # MODIFY: user-center paths (Task 1 — the contract)
└── src/app/
    ├── api/v1/org/route.ts           # NEW: GET/PATCH org profile (+test)
    ├── api/v1/team/members/route.ts  # NEW: GET members (+test)
    ├── api/v1/team/members/[memberId]/route.ts  # NEW: PATCH/DELETE (+test)
    ├── api/v1/sessions/route.ts      # NEW: GET sessions (+test)
    ├── api/v1/sessions/[sessionId]/revoke/route.ts  # NEW: POST revoke (+test)
    ├── api/v1/audit/route.ts         # NEW: GET audit trail (+test)
    └── (dashboard)/
        ├── settings/page.tsx         # NEW: org profile UI
        ├── team/page.tsx             # NEW: members + invite UI
        ├── access/page.tsx           # NEW: sessions UI (+ link to API keys)
        ├── audit/page.tsx            # NEW: audit trail UI
        └── components/dashboard/     # NEW: OrgProfileForm, TeamTable, MemberInviteForm, SessionTable, AuditTable
```

---

## Task 1: User-center API contract (the handoff artifact)

**Files:**
- Modify: `portal/spec/openapi.yaml` (add `paths` entries + `components.schemas`)
- Test: `portal/src/lib/openapi/contract.test.ts`

**Interfaces:**
- Consumes: existing `paths:` block of `portal/spec/openapi.yaml` (auth/api-keys, scans, waf, siem, compliance, payments).
- Produces: the contract that Tasks 6-9 implement and Task 11 verifies against. Paths: `/org`, `/team/members`, `/team/members/{memberId}`, `/sessions`, `/sessions/{sessionId}/revoke`, `/audit`, plus `/invitations` (exists in code, missing from spec).

- [ ] **Step 1: Write the failing contract test**

Create `portal/src/lib/openapi/contract.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

function loadSpec(): Record<string, any> {
  const file = fs.readFileSync(path.join(process.cwd(), "spec", "openapi.yaml"), "utf-8");
  return yaml.load(file) as Record<string, any>;
}

describe("user center API contract", () => {
  const spec = loadSpec();
  const paths = spec.paths ?? {};

  it("documents org profile", () => {
    expect(paths["/org"]).toBeDefined();
    expect(paths["/org"].get).toBeDefined();
    expect(paths["/org"].patch).toBeDefined();
  });

  it("documents team management", () => {
    expect(paths["/team/members"].get).toBeDefined();
    const member = paths["/team/members/{memberId}"];
    expect(member.patch).toBeDefined();
    expect(member.delete).toBeDefined();
  });

  it("documents sessions", () => {
    expect(paths["/sessions"].get).toBeDefined();
    expect(paths["/sessions/{sessionId}/revoke"].post).toBeDefined();
  });

  it("documents the audit trail", () => {
    expect(paths["/audit"].get).toBeDefined();
  });

  it("documents invitations", () => {
    expect(paths["/invitations"].post).toBeDefined();
  });

  it("defines shared schemas", () => {
    const schemas = spec.components?.schemas ?? {};
    for (const name of ["OrgProfile", "ContactInput", "Member", "Session", "AuditEvent", "Error"]) {
      expect(schemas[name], `missing schema ${name}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/openapi/contract.test.ts`
Expected: FAIL — `/org` path undefined.

- [ ] **Step 3: Extend the OpenAPI spec**

In `portal/spec/openapi.yaml`, inside the existing `paths:` block (after the last path), add:

```yaml
  /org:
    get:
      operationId: getOrgProfile
      summary: Current organization profile (derived from identity)
      tags: [user-center]
      security: [{ bearerAuth: [] }]
      responses:
        '200':
          description: Org profile
          content:
            application/json:
              schema: { $ref: '#/components/schemas/OrgProfile' }
        '401': { $ref: '#/components/responses/Unauthorized' }
    patch:
      operationId: updateOrgProfile
      summary: Update organization profile (owner only)
      tags: [user-center]
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/OrgProfileUpdate' }
      responses:
        '200':
          description: Updated profile
          content:
            application/json:
              schema: { $ref: '#/components/schemas/OrgProfile' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /team/members:
    get:
      operationId: listTeamMembers
      summary: List organization members with roles
      tags: [user-center]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: status, in: query, schema: { type: string, enum: [active, invited] }, description: filter by membership status }
      responses:
        '200':
          description: Members
          content:
            application/json:
              schema:
                type: object
                properties:
                  members:
                    type: array
                    items: { $ref: '#/components/schemas/Member' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /team/members/{memberId}:
    patch:
      operationId: updateMemberRole
      summary: Change a member's role (owner/security admin)
      tags: [user-center]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: memberId, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [role]
              properties:
                role: { $ref: '#/components/schemas/Role' }
      responses:
        '200':
          description: Updated member
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Member' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
    delete:
      operationId: removeTeamMember
      summary: Remove a member (revokes their sessions)
      tags: [user-center]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: memberId, in: path, required: true, schema: { type: string } }
      responses:
        '204': { description: Member removed }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
  /sessions:
    get:
      operationId: listSessions
      summary: List active sessions in the organization
      tags: [user-center]
      security: [{ bearerAuth: [] }]
      responses:
        '200':
          description: Sessions
          content:
            application/json:
              schema:
                type: object
                properties:
                  sessions:
                    type: array
                    items: { $ref: '#/components/schemas/Session' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /sessions/{sessionId}/revoke:
    post:
      operationId: revokeSession
      summary: Revoke a session (own session, or any session for owner/security admin)
      tags: [user-center]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: sessionId, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: Session revoked
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Session' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
  /audit:
    get:
      operationId: listAuditEvents
      summary: Organization audit trail (owner/security admin)
      tags: [user-center]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: action, in: query, schema: { type: string } }
        - { name: resourceType, in: query, schema: { type: string } }
        - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 100, default: 50 } }
        - { name: cursor, in: query, schema: { type: string } }
      responses:
        '200':
          description: Audit events
          content:
            application/json:
              schema:
                type: object
                properties:
                  events:
                    type: array
                    items: { $ref: '#/components/schemas/AuditEvent' }
                  nextCursor: { type: [string, 'null'] }
        '403': { $ref: '#/components/responses/Forbidden' }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /invitations:
    post:
      operationId: createInvitation
      summary: Invite a member (owner/security admin)
      tags: [user-center]
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email]
              properties:
                email: { type: string, format: email }
                role: { $ref: '#/components/schemas/Role' }
      responses:
        '201':
          description: Invitation created
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: string }
                  email: { type: string }
                  expiresAt: { type: [string, 'null'] }
        '400': { $ref: '#/components/responses/BadRequest' }
        '403': { $ref: '#/components/responses/Forbidden' }
```

Then add the shared schemas to `components.schemas` (or create the `components` block if the spec lacks one — it has `securitySchemes` somewhere; keep additions additive):

```yaml
  components:
    responses:
      Unauthorized:
        description: Missing or invalid credentials
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Error' }
      Forbidden:
        description: Role lacks permission
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Error' }
      NotFound:
        description: Resource not found
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Error' }
      BadRequest:
        description: Invalid request
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Error' }
    schemas:
      Error:
        type: object
        required: [error]
        properties:
          error: { type: string }
      Role:
        type: string
        enum: [organization_owner, security_admin, asset_manager, scan_operator, report_viewer, billing_admin]
      ContactInput:
        type: object
        required: [type, name, email]
        properties:
          id: { type: string, description: set to update an existing contact }
          type: { type: string, enum: [business, security, billing, emergency] }
          name: { type: string }
          email: { type: string, format: email }
          phone: { type: [string, 'null'] }
          escalationOrder: { type: integer, default: 1 }
      OrgProfile:
        type: object
        required: [id, name]
        properties:
          id: { type: string }
          name: { type: string }
          parentOrgId: { type: [string, 'null'] }
          parentName: { type: [string, 'null'] }
          contacts:
            type: array
            items: { $ref: '#/components/schemas/ContactInput' }
      OrgProfileUpdate:
        type: object
        properties:
          name: { type: string, minLength: 1, maxLength: 200 }
          contacts:
            type: array
            items: { $ref: '#/components/schemas/ContactInput' }
      Member:
        type: object
        required: [id, userId, email, role, status]
        properties:
          id: { type: string }
          userId: { type: string }
          email: { type: string }
          role: { $ref: '#/components/schemas/Role' }
          status: { type: string, enum: [active, invited] }
          joinedAt: { type: [string, 'null'] }
      Session:
        type: object
        required: [id, userId, lastSeenAt, createdAt]
        properties:
          id: { type: string }
          userId: { type: string }
          userAgent: { type: [string, 'null'] }
          lastSeenAt: { type: string, format: date-time }
          createdAt: { type: string, format: date-time }
          revokedAt: { type: [string, 'null'] }
      AuditEvent:
        type: object
        required: [id, action, resourceType, createdAt]
        properties:
          id: { type: string }
          action: { type: string }
          resourceType: { type: string }
          resourceId: { type: [string, 'null'] }
          actorUserId: { type: [string, 'null'] }
          reason: { type: [string, 'null'] }
          createdAt: { type: string, format: date-time }
```

If the spec already has a `components:` block, merge these keys into it rather than duplicating. Do not touch existing paths in this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/openapi/contract.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add portal/spec/openapi.yaml portal/src/lib/openapi/contract.test.ts
git commit -m "docs(portal): user center API contract — org/team/sessions/audit paths + schemas"
```

---

## Task 2: RBAC actions for the user center

**Files:**
- Modify: `portal/src/lib/auth/rbac.ts` (`can()`)
- Test: `portal/src/lib/auth/rbac.test.ts`

**Interfaces:**
- Consumes: `TenantContext` from `@/lib/tenant` (fields `userId`, `organizationId`, `role`, `isStaff`, `appMode`).
- Produces: `can(ctx, action)` cases: `org.view` (any member), `org.manage` (owner), `team.view` (owner/security_admin/asset_manager), `team.manage` (owner/security_admin), `session.revoke` (owner/security_admin; self-revoke handled in the route by ownership check), `audit.view` (owner/security_admin). Used by Tasks 6-9 routes.

- [ ] **Step 1: Write the failing test**

Append to `portal/src/lib/auth/rbac.test.ts`:
```ts
describe("user center actions", () => {
  const owner: TenantContext = { userId: "u1", organizationId: "o1", role: "organization_owner", isStaff: false, appMode: "prod" };
  const sec: TenantContext = { userId: "u2", organizationId: "o1", role: "security_admin", isStaff: false, appMode: "prod" };
  const mgr: TenantContext = { userId: "u3", organizationId: "o1", role: "asset_manager", isStaff: false, appMode: "prod" };
  const viewer: TenantContext = { userId: "u4", organizationId: "o1", role: "report_viewer", isStaff: false, appMode: "prod" };

  it("org.view is open to any member, org.manage to owners only", () => {
    for (const u of [owner, sec, mgr, viewer]) expect(can(u, "org.view")).toBe(true);
    expect(can(owner, "org.manage")).toBe(true);
    for (const u of [sec, mgr, viewer]) expect(can(u, "org.manage")).toBe(false);
  });

  it("team.view excludes viewers; team.manage is owner/security_admin", () => {
    for (const u of [owner, sec, mgr]) expect(can(u, "team.view")).toBe(true);
    expect(can(viewer, "team.view")).toBe(false);
    expect(can(owner, "team.manage")).toBe(true);
    expect(can(sec, "team.manage")).toBe(true);
    expect(can(mgr, "team.manage")).toBe(false);
    expect(can(viewer, "team.manage")).toBe(false);
  });

  it("session.revoke and audit.view are owner/security_admin", () => {
    expect(can(owner, "session.revoke")).toBe(true);
    expect(can(sec, "session.revoke")).toBe(true);
    expect(can(mgr, "session.revoke")).toBe(false);
    expect(can(owner, "audit.view")).toBe(true);
    expect(can(sec, "audit.view")).toBe(true);
    expect(can(mgr, "audit.view")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/auth/rbac.test.ts`
Expected: FAIL — `org.view` returns false (unknown action).

- [ ] **Step 3: Add the actions to `can()`**

In `portal/src/lib/auth/rbac.ts`, after the `api-key.manage` line, add:
```ts
  if (action === "org.view") return true; // any authenticated member
  if (action === "org.manage") return hasRole(user, "organization_owner");
  if (action === "team.view") return hasRole(user, "organization_owner", "security_admin", "asset_manager");
  if (action === "team.manage") return hasRole(user, "organization_owner", "security_admin");
  if (action === "session.revoke") return hasRole(user, "organization_owner", "security_admin");
  if (action === "audit.view") return hasRole(user, "organization_owner", "security_admin");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/auth/rbac.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/auth/rbac.ts portal/src/lib/auth/rbac.test.ts
git commit -m "feat(portal): RBAC actions for user center (org/team/session/audit)"
```

---

## Task 3: Session model + RLS migration

**Files:**
- Modify: `portal/prisma/schema.prisma` (Session model + relations)
- Create: `portal/prisma/migrations/<timestamp>_user_center_sessions/migration.sql` (table + RLS + grants)
- Test: `portal/src/lib/org/session-rls.test.ts`

**Interfaces:**
- Consumes: `User`, `Organization` models.
- Produces: `Session` model — fields `id`, `organizationId`, `userId`, `tokenHash` (@unique), `userAgent?`, `ipHash?`, `lastSeenAt`, `createdAt`, `revokedAt?`, `revokedById?`; indexes `[organizationId, userId]`, `[organizationId, lastSeenAt]`. Used by Task 4.

- [ ] **Step 1: Write the failing RLS test**

Create `portal/src/lib/org/session-rls.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_session_rls_0001";
const USER = "user_session_rls_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    await admin.query(`DELETE FROM "Session" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("Session RLS", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Session RLS Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-session-rls", email: "s@x.com" } });
    });
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("asv_app insert without tenant context is rejected (42501)", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Session" ("id","organizationId","userId","tokenHash") VALUES ($1,$2,$3,$4)`,
        "sx1", ORG, USER, "tok-hash-x"
      )
    ).rejects.toThrow(/42501/);
  });

  it("asv_app insert inside tenant context succeeds", async () => {
    await withTenant(ORG, (tx) =>
      tx.session.create({ data: { id: "sx2", organizationId: ORG, userId: USER, tokenHash: "tok-hash-ok" } })
    );
    const found = await withTenant(ORG, (tx) => tx.session.findUnique({ where: { tokenHash: "tok-hash-ok" } }));
    expect(found?.organizationId).toBe(ORG);
  });

  it("session table grants exclude DELETE for asv_app (revoke, never delete)", async () => {
    await withTenant(ORG, (tx) =>
      tx.session.create({ data: { id: "sx3", organizationId: ORG, userId: USER, tokenHash: "tok-hash-del" } })
    );
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "Session" WHERE "id" = 'sx3'`)
    ).rejects.toThrow(/permission denied/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/org/session-rls.test.ts`
Expected: FAIL — `prisma.session` undefined (model missing) or relation error.

- [ ] **Step 3: Add the Session model to the schema**

In `portal/prisma/schema.prisma`, add:

```prisma
model Session {
  id             String    @id @default(cuid())
  organizationId String
  userId         String
  tokenHash      String    @unique
  userAgent      String?
  ipHash         String?
  lastSeenAt     DateTime  @default(now())
  createdAt      DateTime  @default(now())
  revokedAt      DateTime?
  revokedById    String?
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization   Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId, userId])
  @@index([organizationId, lastSeenAt])
}
```

Add `sessions Session[]` to both `User` and `Organization` relation arrays.

- [ ] **Step 4: Generate the migration + append RLS/grants**

```bash
cd portal
npx prisma migrate diff --from-url "$ADMIN_DATABASE_URL" --to-schema prisma/schema.prisma --script > /tmp/session_migration.sql
mkdir -p prisma/migrations/20260831000001_user_center_sessions
cp /tmp/session_migration.sql prisma/migrations/20260831000001_user_center_sessions/migration.sql
```

Append to that migration.sql (fail-closed pattern):

```sql
-- User center: session registry RLS (fail-closed pattern).
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_tenant_isolation ON "Session"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

-- asv_app can SELECT (list/blocked-check), INSERT + UPDATE (upsert lastSeenAt,
-- set revokedAt). NO DELETE: sessions are revoked, never deleted.
GRANT SELECT, INSERT, UPDATE ON "Session" TO asv_app;
```

Verify the diff did not drop `Asset_active_unique` (if it did, re-append the partial index SQL from `20260830000002_phase2_assets`).

```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/org/session-rls.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add portal/prisma/schema.prisma portal/prisma/migrations/20260831000001_user_center_sessions
git commit -m "feat(portal): Session model + RLS (revoke, never delete)"
```

---

## Task 4: Session registry service

**Files:**
- Create: `portal/src/lib/org/sessions.ts`
- Test: `portal/src/lib/org/sessions.test.ts`

**Interfaces:**
- Consumes: `prisma` (`@/lib/prisma-client`), `setRlsContext` + `TenantContext` (`@/lib/tenant`), `recordAudit` (`@/lib/audit`).
- Produces:
  - `hashToken(token: string): string` — sha256 hex.
  - `sessionModelAvailable(): boolean` — true when the generated client has the `session` model.
  - `recordSessionAccess(ctx: TenantContext, input: { tokenHash: string; userAgent?: string; ipHash?: string }): Promise<void>` — upsert by tokenHash (never clears `revokedAt`).
  - `listActiveSessions(ctx: TenantContext): Promise<Session[]>` — org-scoped, `revokedAt IS NULL`, newest first.
  - `getSession(ctx: TenantContext, sessionId: string): Promise<Session | null>` — org-scoped.
  - `revokeSession(ctx: TenantContext, sessionId: string, reason?: string): Promise<Session | null>` — org-scoped; sets `revokedAt` + `revokedById`; writes `session.revoked` audit; no-op if already revoked.
  - `isSessionBlocked(organizationId: string, tokenHash: string): Promise<boolean>` — true when a revoked row exists for tokenHash (RLS-scoped; used by Task 5).
  - `sessionMetaFromRequest(request: { headers: { get(name: string): string | null } }): { tokenHash: string; userAgent?: string; ipHash?: string } | null` — derives tokenHash from the `Authorization: Bearer <token>` header.

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/org/sessions.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import {
  hashToken, recordSessionAccess, listActiveSessions, getSession,
  revokeSession, isSessionBlocked, sessionMetaFromRequest,
} from "@/lib/org/sessions";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_session_svc_0001";
const ORG2 = "org_session_svc_0002";
const USER = "user_session_svc_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "organization_owner", isStaff: false, appMode: "prod" };
const ctx2: TenantContext = { userId: USER, organizationId: ORG2, role: "organization_owner", isStaff: false, appMode: "prod" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG, ORG2]) {
      await admin.query(`DELETE FROM "Session" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("session registry service", () => {
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG, ORG2]) {
      await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Svc ${o}` } }));
    }
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-svc", email: "svc@x.com" } }));
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("hashToken is deterministic sha256 hex", () => {
    expect(hashToken("tok-1")).toBe(hashToken("tok-1"));
    expect(hashToken("tok-1")).not.toBe(hashToken("tok-2"));
    expect(hashToken("tok-1")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records a session and refreshes lastSeenAt on reuse (no duplicate rows)", async () => {
    const h = hashToken("tok-a");
    await recordSessionAccess(ctx, { tokenHash: h, userAgent: "ua1" });
    await new Promise((r) => setTimeout(r, 5));
    await recordSessionAccess(ctx, { tokenHash: h, userAgent: "ua1" });
    const rows = await withTenant(ORG, (tx) => tx.session.findMany({ where: { tokenHash: h } }));
    expect(rows).toHaveLength(1);
    const all = await listActiveSessions(ctx);
    expect(all.map((s) => s.tokenHash)).toContain(h);
  });

  it("revokeSession sets revokedAt + revokedById and writes audit; blocked check flips", async () => {
    const h = hashToken("tok-b");
    await recordSessionAccess(ctx, { tokenHash: h });
    const session = (await listActiveSessions(ctx)).find((s) => s.tokenHash === h)!;
    expect(await isSessionBlocked(ORG, h)).toBe(false);

    const revoked = await revokeSession(ctx, session.id, "lost device");
    expect(revoked?.revokedAt).not.toBeNull();
    expect(revoked?.revokedById).toBe(USER);

    expect(await isSessionBlocked(ORG, h)).toBe(true);
    expect(await listActiveSessions(ctx)).not.toContainEqual(expect.objectContaining({ id: session.id }));

    const audits = await withTenant(ORG, (tx) =>
      tx.auditEvent.findMany({ where: { action: "session.revoked", resourceId: session.id } })
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("revoking an unknown/other-org session returns null (RLS-scoped)", async () => {
    expect(await revokeSession(ctx, "session_does_not_exist")).toBeNull();
    const h = hashToken("tok-c");
    await recordSessionAccess(ctx, { tokenHash: h });
    const session = (await listActiveSessions(ctx)).find((s) => s.tokenHash === h)!;
    expect(await revokeSession(ctx2, session.id)).toBeNull(); // other org, RLS hides it
    expect(await getSession(ctx, session.id)).not.toBeNull();
    expect(await getSession(ctx2, session.id)).toBeNull();
  });

  it("recordSessionAccess never un-revokes a revoked session", async () => {
    const h = hashToken("tok-d");
    await recordSessionAccess(ctx, { tokenHash: h });
    const session = (await listActiveSessions(ctx)).find((s) => s.tokenHash === h)!;
    await revokeSession(ctx, session.id);
    await recordSessionAccess(ctx, { tokenHash: h }); // replayed token
    expect(await isSessionBlocked(ORG, h)).toBe(true);
  });

  it("sessionMetaFromRequest hashes the Bearer token", () => {
    const meta = sessionMetaFromRequest({ headers: { get: (n: string) => (n === "authorization" ? "Bearer abc.def" : n === "user-agent" ? "curl" : null) } });
    expect(meta?.tokenHash).toBe(hashToken("abc.def"));
    expect(meta?.userAgent).toBe("curl");
    const none = sessionMetaFromRequest({ headers: { get: () => null } });
    expect(none).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/org/sessions.test.ts`
Expected: FAIL — module `@/lib/org/sessions` not found.

- [ ] **Step 3: Implement the service**

Create `portal/src/lib/org/sessions.ts`:
```ts
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, Session } from "@/lib/generated/prisma";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

/**
 * True when the generated Prisma client exposes the Session model. The
 * session registry is additive: callers (auth path, tests mocking an older
 * prisma surface) proceed without it instead of crashing.
 */
export function sessionModelAvailable(): boolean {
  return typeof (prisma as { session?: { findUnique?: unknown } }).session?.findUnique === "function";
}

/**
 * Records (or refreshes) an authenticated access. One JWT = one session row,
 * keyed by the sha256 of the raw token. A revoked row is never un-revoked.
 */
export async function recordSessionAccess(
  ctx: TenantContext,
  input: { tokenHash: string; userAgent?: string; ipHash?: string }
): Promise<void> {
  if (!sessionModelAvailable()) return;
  await withTenant(ctx.organizationId, (tx) =>
    tx.session.upsert({
      where: { tokenHash: input.tokenHash },
      update: { lastSeenAt: new Date(), userAgent: input.userAgent ?? null, ipHash: input.ipHash ?? null },
      create: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        tokenHash: input.tokenHash,
        userAgent: input.userAgent,
        ipHash: input.ipHash,
      },
    })
  );
}

export async function listActiveSessions(ctx: TenantContext): Promise<Session[]> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.session.findMany({
      where: { organizationId: ctx.organizationId, revokedAt: null },
      orderBy: { lastSeenAt: "desc" },
    })
  );
}

export async function getSession(ctx: TenantContext, sessionId: string): Promise<Session | null> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.session.findUnique({ where: { id: sessionId } })
  );
}

export async function revokeSession(
  ctx: TenantContext,
  sessionId: string,
  reason?: string
): Promise<Session | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const session = await tx.session.findUnique({ where: { id: sessionId } });
    if (!session || session.revokedAt) return session ?? null;
    const updated = await tx.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedById: ctx.userId },
    });
    await recordAudit(ctx, "session.revoked", "Session", sessionId, { revokedAt: null }, { revokedAt: updated.revokedAt }, reason, tx);
    return updated;
  });
}

/** True when tokenHash maps to a revoked session row in the org (RLS-scoped). */
export async function isSessionBlocked(organizationId: string, tokenHash: string): Promise<boolean> {
  if (!sessionModelAvailable()) return false;
  return withTenant(organizationId, async (tx) => {
    const session = await tx.session.findUnique({ where: { tokenHash } });
    return session?.revokedAt != null;
  });
}

/** Derives session metadata from a request: sha256 of the Bearer token. */
export function sessionMetaFromRequest(request: {
  headers: { get(name: string): string | null };
}): { tokenHash: string; userAgent?: string; ipHash?: string } | null {
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) return null;
  const userAgent = request.headers.get("user-agent") ?? undefined;
  const forwarded = request.headers.get("x-forwarded-for") ?? undefined;
  const ip = forwarded?.split(",")[0]?.trim();
  return {
    tokenHash: hashToken(match[1]),
    userAgent,
    ipHash: ip ? hashIp(ip) : undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/org/sessions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/org/sessions.ts portal/src/lib/org/sessions.test.ts
git commit -m "feat(portal): session registry service (hash-only, revoke never deletes)"
```

---

## Task 5: Wire session block + record into auth

**Files:**
- Modify: `portal/src/lib/tenant.ts` (`tenantContextFromRequest`)
- Test: `portal/src/lib/org/auth-session.test.ts`

**Interfaces:**
- Consumes: `isSessionBlocked`, `recordSessionAccess`, `sessionMetaFromRequest` (Task 4).
- Produces: behavior — after a tenant context resolves, a revoked token makes `tenantContextFromRequest` return `null` (→ 401); valid tokens get their session recorded. Registry unavailability never breaks auth (availability over registry), but a revoked row is authoritative when the registry is reachable.

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/org/auth-session.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Client } from "pg";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { tenantContextFromRequest, setRlsContext } from "@/lib/tenant";
import { hashToken, revokeSession } from "@/lib/org/sessions";
import type { Prisma } from "@/lib/generated/prisma";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })),
}));

const ORG = "org_auth_sess_0001";
const USER = "user_auth_sess_0001";
const IDP = "kc-auth-sess";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

function bearerRequest(token: string) {
  return new NextRequest("http://localhost/api/v1/org", {
    headers: { Authorization: `Bearer ${token}`, "user-agent": "vitest" },
  });
}

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    await admin.query(`DELETE FROM "Session" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "OrganizationMembership" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("session enforcement in auth", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Auth Sess Org" } });
      await tx.user.create({ data: { id: USER, idpId: IDP, email: "a@x.com" } });
      await tx.organizationMembership.create({ data: { userId: USER, organizationId: ORG, role: "organization_owner" } });
    });
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { sub: IDP, email: "a@x.com" }, protectedHeader: {} } as never);
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("records a session row on first authenticated request", async () => {
    const ctx = await tenantContextFromRequest(bearerRequest("tok-1"));
    expect(ctx?.organizationId).toBe(ORG);
    const rows = await withTenant(ORG, (tx) => tx.session.findMany({ where: { tokenHash: hashToken("tok-1") } }));
    expect(rows).toHaveLength(1);
  });

  it("a revoked token is rejected on the next request", async () => {
    const ctx = await tenantContextFromRequest(bearerRequest("tok-2"));
    expect(ctx).not.toBeNull();
    const rows = await withTenant(ORG, (tx) => tx.session.findMany({ where: { tokenHash: hashToken("tok-2") } }));
    await revokeSession(ctx!, rows[0].id, "test revoke");
    expect(await tenantContextFromRequest(bearerRequest("tok-2"))).toBeNull();
    // a different (fresh) token still works
    expect(await tenantContextFromRequest(bearerRequest("tok-3"))).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/org/auth-session.test.ts`
Expected: FAIL — no session row recorded (auth path not wired).

- [ ] **Step 3: Wire the session check into `tenantContextFromRequest`**

In `portal/src/lib/tenant.ts`, import the three helpers, then change the tail of `tenantContextFromRequest` from:

```ts
  try {
    return await resolveTenantContext(user.id);
  } catch {
    return null;
  }
```

to:

```ts
  let ctx: TenantContext | null = null;
  try {
    ctx = await resolveTenantContext(user.id);
  } catch {
    return null;
  }
  // Session registry (user center): a revoked token is rejected; a valid
  // token is recorded. Registry unavailability never breaks auth (availability
  // over registry) — but when reachable, a revoked row is authoritative.
  try {
    const meta = sessionMetaFromRequest(request);
    if (meta) {
      if (await isSessionBlocked(ctx.organizationId, meta.tokenHash)) return null;
      await recordSessionAccess(ctx, meta);
    }
  } catch (err) {
    console.error("session registry error (auth continues):", err);
  }
  return ctx;
```

- [ ] **Step 4: Run the full suite to verify nothing regressed**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run`
Expected: PASS — all existing tests (route tests mock a prisma surface without `session`; `sessionModelAvailable()` makes the auth path skip cleanly) and the 2 new tests.

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/tenant.ts portal/src/lib/org/auth-session.test.ts
git commit -m "feat(portal): revoke-aware auth — revoked tokens rejected, valid ones recorded"
```

---

## Task 6: Org profile + contacts API

**Files:**
- Create: `portal/src/lib/org/profile.ts`
- Test: `portal/src/lib/org/profile.test.ts`
- Create: `portal/src/app/api/v1/org/route.ts`
- Test: `portal/src/app/api/v1/org/route.test.ts`

**Interfaces:**
- Consumes: `TenantContext`, `can()` actions `org.view`/`org.manage`, `getParentOrg` (`@/lib/tenant`), `recordAudit`.
- Produces:
  - `getOrgProfile(ctx: TenantContext): Promise<{ id: string; name: string; parentOrgId: string | null; parentName: string | null; contacts: Contact[] }>` — org row + contacts, RLS-scoped.
  - `updateOrgProfile(ctx: TenantContext, input: { name?: string; contacts?: { id?: string; type: string; name: string; email: string; phone?: string | null; escalationOrder?: number }[] }): Promise<ReturnType<typeof getOrgProfile>>` — updates name (validated), upserts contacts (id → update; no id → create), writes `org.profile.updated` audit.
  - Route `GET /api/v1/org` (gate `org.view`), `PATCH /api/v1/org` (gate `org.manage`, 400 on invalid body).

- [ ] **Step 1: Write the failing service test**

Create `portal/src/lib/org/profile.test.ts` (real DB, fixed ids — same harness as Task 4):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { getOrgProfile, updateOrgProfile } from "@/lib/org/profile";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_profile_0001";
const ORG2 = "org_profile_0002";
const USER = "user_profile_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "organization_owner", isStaff: false, appMode: "prod" };
const ctx2: TenantContext = { userId: USER, organizationId: ORG2, role: "organization_owner", isStaff: false, appMode: "prod" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG, ORG2]) {
      await admin.query(`DELETE FROM "Contact" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("org profile service", () => {
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG, ORG2]) {
      await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Prof ${o}` } }));
    }
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-prof", email: "p@x.com" } }));
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("reads the org profile with contacts", async () => {
    await updateOrgProfile(ctx, { contacts: [{ type: "security", name: "Alice", email: "a@sec.com", escalationOrder: 1 }] });
    const profile = await getOrgProfile(ctx);
    expect(profile.id).toBe(ORG);
    expect(profile.contacts.some((c) => c.email === "a@sec.com")).toBe(true);
  });

  it("updates name and upserts contacts; empty name rejected", async () => {
    const updated = await updateOrgProfile(ctx, { name: "Renamed Org" });
    expect(updated.name).toBe("Renamed Org");
    await expect(updateOrgProfile(ctx, { name: "   " })).rejects.toThrow(/name/);
  });

  it("updates an existing contact by id instead of duplicating", async () => {
    const before = await getOrgProfile(ctx);
    const contact = before.contacts.find((c) => c.email === "a@sec.com")!;
    await updateOrgProfile(ctx, { contacts: [{ id: contact.id, type: "security", name: "Alice B", email: "a@sec.com" }] });
    const after = await getOrgProfile(ctx);
    const updated = after.contacts.find((c) => c.id === contact.id)!;
    expect(updated.name).toBe("Alice B");
    expect(after.contacts.filter((c) => c.email === "a@sec.com")).toHaveLength(1);
  });

  it("is tenant-scoped: other org sees its own profile, not ours", async () => {
    const theirs = await getOrgProfile(ctx2);
    expect(theirs.id).toBe(ORG2);
    expect(theirs.contacts.some((c) => c.email === "a@sec.com")).toBe(false);
  });

  it("records an audit event on update", async () => {
    await updateOrgProfile(ctx, { name: "Audited Org" });
    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { action: "org.profile.updated" } }));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/org/profile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `portal/src/lib/org/profile.ts`:
```ts
import { prisma } from "@/lib/prisma-client";
import { setRlsContext, getParentOrg } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, Contact } from "@/lib/generated/prisma";

const CONTACT_TYPES = ["business", "security", "billing", "emergency"] as const;

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

export interface OrgProfile {
  id: string;
  name: string;
  parentOrgId: string | null;
  parentName: string | null;
  contacts: Contact[];
}

export interface ContactInput {
  id?: string;
  type: string;
  name: string;
  email: string;
  phone?: string | null;
  escalationOrder?: number;
}

export async function getOrgProfile(ctx: TenantContext): Promise<OrgProfile> {
  return withTenant(ctx.organizationId, async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: ctx.organizationId } });
    if (!org) throw new Error("Organization not found");
    const parent = org.parentOrgId ? await tx.organization.findUnique({ where: { id: org.parentOrgId } }) : null;
    const contacts = await tx.contact.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { escalationOrder: "asc" } });
    return {
      id: org.id,
      name: org.name,
      parentOrgId: org.parentOrgId,
      parentName: parent?.name ?? null,
      contacts,
    };
  });
}

export async function updateOrgProfile(
  ctx: TenantContext,
  input: { name?: string; contacts?: ContactInput[] }
): Promise<OrgProfile> {
  return withTenant(ctx.organizationId, async (tx) => {
    const before = await tx.organization.findUnique({ where: { id: ctx.organizationId } });
    if (!before) throw new Error("Organization not found");

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("name must be a non-empty string");
      if (name.length > 200) throw new Error("name too long");
      await tx.organization.update({ where: { id: ctx.organizationId }, data: { name } });
    }

    for (const c of input.contacts ?? []) {
      if (!CONTACT_TYPES.includes(c.type as (typeof CONTACT_TYPES)[number])) {
        throw new Error(`contact type must be one of ${CONTACT_TYPES.join(", ")}`);
      }
      if (!c.name?.trim() || !c.email?.trim()) throw new Error("contact name and email are required");
      if (c.id) {
        const existing = await tx.contact.findFirst({ where: { id: c.id, organizationId: ctx.organizationId } });
        if (existing) {
          await tx.contact.update({
            where: { id: c.id },
            data: { type: c.type, name: c.name.trim(), email: c.email.trim(), phone: c.phone ?? null, escalationOrder: c.escalationOrder ?? 1 },
          });
        }
      } else {
        await tx.contact.create({
          data: {
            organizationId: ctx.organizationId,
            type: c.type,
            name: c.name.trim(),
            email: c.email.trim(),
            phone: c.phone ?? null,
            escalationOrder: c.escalationOrder ?? 1,
          },
        });
      }
    }

    await recordAudit(ctx, "org.profile.updated", "Organization", ctx.organizationId, { name: before.name }, { name: input.name ?? before.name }, undefined, tx);

    const org = await tx.organization.findUnique({ where: { id: ctx.organizationId } });
    const parent = org!.parentOrgId ? await tx.organization.findUnique({ where: { id: org!.parentOrgId } }) : null;
    const contacts = await tx.contact.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { escalationOrder: "asc" } });
    return { id: org!.id, name: org!.name, parentOrgId: org!.parentOrgId, parentName: parent?.name ?? null, contacts };
  });
}
```

- [ ] **Step 4: Run service test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/org/profile.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing route test**

Create `portal/src/app/api/v1/org/route.test.ts` (mock pattern from `auth/api-keys/route.test.ts`; the txMock includes `session` so the Task 5 auth path runs cleanly):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { GET, PATCH } from "./route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn(), update: vi.fn() },
    contact: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn(), findMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-org-1", email: "owner@x.com" };

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/v1/org", {
    method,
    headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function setup(role: string, orgRow?: Record<string, unknown>) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
  vi.mocked(prisma.organization.findUnique).mockResolvedValue(orgRow ?? { id: "org_1", name: "Acme", parentOrgId: null, createdAt: new Date(), updatedAt: new Date() } as never);
  vi.mocked(prisma.contact.findMany).mockResolvedValue([] as never);
}

describe("org profile routes", () => {
  beforeEach(() => { vi.stubEnv("APP_MODE", "prod"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("GET returns the org profile for any member", async () => {
    setup("report_viewer");
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("org_1");
  });

  it("PATCH is 403 for non-owners", async () => {
    setup("report_viewer");
    const res = await PATCH(req("PATCH", { name: "Hacked" }));
    expect(res.status).toBe(403);
  });

  it("PATCH is 400 for an empty name", async () => {
    setup("organization_owner");
    const res = await PATCH(req("PATCH", { name: "  " }));
    expect(res.status).toBe(400);
  });

  it("PATCH updates and returns the profile for an owner", async () => {
    setup("organization_owner");
    vi.mocked(prisma.organization.update).mockResolvedValue({ id: "org_1", name: "New Name" } as never);
    const res = await PATCH(req("PATCH", { name: "New Name" }));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("New Name");
    expect(prisma.auditEvent.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run route test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/app/api/v1/org/route.test.ts`
Expected: FAIL — module `./route` not found.

- [ ] **Step 7: Implement the route**

Create `portal/src/app/api/v1/org/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { getOrgProfile, updateOrgProfile } from "@/lib/org/profile";

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "org.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const profile = await getOrgProfile(ctx);
  return NextResponse.json(profile);
}

export async function PATCH(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "org.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name : undefined;
  const contacts = Array.isArray(body.contacts) ? body.contacts : undefined;
  try {
    const profile = await updateOrgProfile(ctx, { name, contacts });
    return NextResponse.json(profile);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 8: Run route test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/app/api/v1/org/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add portal/src/lib/org/profile.ts portal/src/lib/org/profile.test.ts portal/src/app/api/v1/org
git commit -m "feat(portal): org profile API (GET/PATCH, owner-gated, contacts)"
```

---

## Task 7: Team management API

**Files:**
- Create: `portal/src/lib/org/team.ts`
- Test: `portal/src/lib/org/team.test.ts`
- Create: `portal/src/app/api/v1/team/members/route.ts`
- Create: `portal/src/app/api/v1/team/members/[memberId]/route.ts`
- Test: `portal/src/app/api/v1/team/members/route.test.ts`

**Interfaces:**
- Consumes: `TenantContext`, `can()` `team.view`/`team.manage`, `isRole`/`ROLES` (`@/lib/tenant`), `recordAudit`.
- Produces:
  - `TeamGuardError` (exported) — thrown on last-owner demotion/removal.
  - `listTeamMembers(ctx: TenantContext, status?: "active" | "invited"): Promise<{ id: string; userId: string; email: string; role: string; status: string; joinedAt: Date | null }[]>` — memberships incl. user email.
  - `updateMemberRole(ctx: TenantContext, memberId: string, role: string): Promise<Member | null>` — guards: role must be a valid `Role`; cannot demote the **last active** `organization_owner`. Audit `member.role.updated`.
  - `removeMember(ctx: TenantContext, memberId: string): Promise<boolean>` — guards: cannot remove the last active owner; on success revokes all of the member's active sessions and writes `member.removed` audit. Returns false when member not found.
  - Routes: `GET /api/v1/team/members` (`team.view`), `PATCH /api/v1/team/members/[memberId]` (`team.manage`), `DELETE /api/v1/team/members/[memberId]` (`team.manage`; 204 on success).

- [ ] **Step 1: Write the failing service test**

Create `portal/src/lib/org/team.test.ts` (same harness as Task 6; two users — owner + member):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { listTeamMembers, updateMemberRole, removeMember, TeamGuardError } from "@/lib/org/team";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_team_0001";
const ORG2 = "org_team_0002";
const OWNER = "user_team_owner_01";
const MEMBER = "user_team_member_01";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ownerCtx: TenantContext = { userId: OWNER, organizationId: ORG, role: "organization_owner", isStaff: false, appMode: "prod" };
const memberCtx: TenantContext = { userId: MEMBER, organizationId: ORG, role: "report_viewer", isStaff: false, appMode: "prod" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG, ORG2]) {
      await admin.query(`DELETE FROM "Session" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "OrganizationMembership" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id IN ($1, $2)`, [OWNER, MEMBER]);
  } finally { await admin.end(); }
}

describe("team service", () => {
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG, ORG2]) await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Team ${o}` } }));
    await withTenant(ORG, async (tx) => {
      await tx.user.create({ data: { id: OWNER, idpId: "kc-team-owner", email: "owner@x.com" } });
      await tx.user.create({ data: { id: MEMBER, idpId: "kc-team-member", email: "member@x.com" } });
      await tx.organizationMembership.create({ data: { userId: OWNER, organizationId: ORG, role: "organization_owner" } });
      await tx.organizationMembership.create({ data: { userId: MEMBER, organizationId: ORG, role: "report_viewer" } });
    });
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("lists members with emails", async () => {
    const members = await listTeamMembers(ownerCtx);
    expect(members.map((m) => m.email).sort()).toEqual(["member@x.com", "owner@x.com"]);
  });

  it("owner changes a member role (audited)", async () => {
    const target = (await listTeamMembers(ownerCtx)).find((m) => m.userId === MEMBER)!;
    const updated = await updateMemberRole(ownerCtx, target.id, "asset_manager");
    expect(updated?.role).toBe("asset_manager");
    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { action: "member.role.updated", resourceId: target.id } }));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects an invalid role", async () => {
    const target = (await listTeamMembers(ownerCtx)).find((m) => m.userId === MEMBER)!;
    await expect(updateMemberRole(ownerCtx, target.id, "superadmin")).rejects.toThrow(/role/);
  });

  it("cannot demote the last organization_owner", async () => {
    const target = (await listTeamMembers(ownerCtx)).find((m) => m.userId === OWNER)!;
    await expect(updateMemberRole(ownerCtx, target.id, "report_viewer")).rejects.toBeInstanceOf(TeamGuardError);
    await expect(removeMember(ownerCtx, target.id)).rejects.toBeInstanceOf(TeamGuardError);
  });

  it("removing a member revokes their active sessions and audits", async () => {
    const { recordSessionAccess, hashToken } = await import("@/lib/org/sessions");
    await recordSessionAccess(memberCtx, { tokenHash: hashToken("member-tok") });
    const target = (await listTeamMembers(ownerCtx)).find((m) => m.userId === MEMBER)!;
    const removed = await removeMember(ownerCtx, target.id);
    expect(removed).toBe(true);
    const sessions = await withTenant(ORG, (tx) => tx.session.findMany({ where: { userId: MEMBER, revokedAt: null } }));
    expect(sessions).toHaveLength(0);
    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { action: "member.removed" } }));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("is tenant-scoped: other org cannot see or mutate our members", async () => {
    const foreign: TenantContext = { userId: OWNER, organizationId: ORG2, role: "organization_owner", isStaff: false, appMode: "prod" };
    const ours = (await listTeamMembers(ownerCtx)).find((m) => m.userId === MEMBER)!;
    expect(await updateMemberRole(foreign, ours.id, "scan_operator")).toBeNull();
    expect(await removeMember(foreign, ours.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/org/team.test.ts`
Expected: FAIL — module `@/lib/org/team` not found.

- [ ] **Step 3: Implement the service**

Create `portal/src/lib/org/team.ts`:
```ts
import { prisma } from "@/lib/prisma-client";
import { setRlsContext, isRole, ROLES } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { revokeSession } from "@/lib/org/sessions";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

export class TeamGuardError extends Error {}

export interface Member {
  id: string;
  userId: string;
  email: string;
  role: string;
  status: string;
  joinedAt: Date | null;
}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

async function countActiveOwners(tx: Prisma.TransactionClient, organizationId: string): Promise<number> {
  return tx.organizationMembership.count({
    where: { organizationId, role: "organization_owner", status: "active" },
  });
}

export async function listTeamMembers(ctx: TenantContext, status?: "active" | "invited"): Promise<Member[]> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.organizationMembership.findMany({
      where: { organizationId: ctx.organizationId, ...(status ? { status } : {}) },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }).then((rows) => rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      email: r.user.email,
      role: r.role,
      status: r.status,
      joinedAt: r.createdAt,
    })))
  );
}

export async function updateMemberRole(
  ctx: TenantContext,
  memberId: string,
  role: string
): Promise<Member | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const membership = await tx.organizationMembership.findUnique({ where: { id: memberId }, include: { user: true } });
    if (!membership || membership.organizationId !== ctx.organizationId) return null;
    if (!isRole(role)) throw new Error(`role must be one of: ${ROLES.join(", ")}`);
    if (membership.role === "organization_owner" && role !== "organization_owner") {
      const owners = await countActiveOwners(tx, ctx.organizationId);
      if (owners <= 1) throw new TeamGuardError("cannot demote the last organization owner");
    }
    const updated = await tx.organizationMembership.update({
      where: { id: memberId },
      data: { role },
      include: { user: true },
    });
    await recordAudit(ctx, "member.role.updated", "OrganizationMembership", memberId, { role: membership.role }, { role }, undefined, tx);
    return { id: updated.id, userId: updated.userId, email: updated.user.email, role: updated.role, status: updated.status, joinedAt: updated.createdAt };
  });
}

export async function removeMember(ctx: TenantContext, memberId: string): Promise<boolean> {
  return withTenant(ctx.organizationId, async (tx) => {
    const membership = await tx.organizationMembership.findUnique({ where: { id: memberId } });
    if (!membership || membership.organizationId !== ctx.organizationId) return false;
    if (membership.role === "organization_owner") {
      const owners = await countActiveOwners(tx, ctx.organizationId);
      if (owners <= 1) throw new TeamGuardError("cannot remove the last organization owner");
    }
    await tx.organizationMembership.delete({ where: { id: memberId } });
    await recordAudit(ctx, "member.removed", "OrganizationMembership", memberId, { userId: membership.userId }, undefined, undefined, tx);
    // Revoke every active session of the removed member (org-scoped).
    const sessions = await tx.session.findMany({ where: { organizationId: ctx.organizationId, userId: membership.userId, revokedAt: null } });
    for (const s of sessions) {
      await tx.session.update({ where: { id: s.id }, data: { revokedAt: new Date(), revokedById: ctx.userId } });
      await recordAudit(ctx, "session.revoked", "Session", s.id, { revokedAt: null }, { revokedAt: new Date() }, "member removed", tx);
    }
    return true;
  });
}
```

- [ ] **Step 4: Run service test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/org/team.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Implement the routes**

Create `portal/src/app/api/v1/team/members/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listTeamMembers } from "@/lib/org/team";

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "team.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const status = request.nextUrl.searchParams.get("status");
  if (status && status !== "active" && status !== "invited") {
    return NextResponse.json({ error: "status must be active or invited" }, { status: 400 });
  }
  const members = await listTeamMembers(ctx, status === "invited" ? "invited" : "active");
  return NextResponse.json({ members });
}
```

Create `portal/src/app/api/v1/team/members/[memberId]/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { updateMemberRole, removeMember } from "@/lib/org/team";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "team.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { memberId } = await params;
  const body = await request.json().catch(() => null);
  const role = typeof body?.role === "string" ? body.role : "";
  try {
    const member = await updateMemberRole(ctx, memberId, role);
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    return NextResponse.json(member);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "team.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { memberId } = await params;
  try {
    const removed = await removeMember(ctx, memberId);
    if (!removed) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 6: Write the failing route test**

Create `portal/src/app/api/v1/team/members/route.test.ts` (mock pattern from Task 6, plus `organizationMembership` getters; assert):
- GET → 403 for `report_viewer` (no `team.view`), 200 for `asset_manager`, 400 for `status=weird`.
- PATCH → 403 for `asset_manager` (no `team.manage`), 400 for invalid role, 404 when service returns null, 200 for owner.
- DELETE → 403 for `asset_manager`, 204 for owner, 404 unknown.

Key mock wiring (extend the Task 6 `setup` with `organizationMembership.findUnique` for the [memberId] handlers — `updateMemberRole`/`removeMember` read the membership by id first):
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { GET } from "./route";
import { PATCH, DELETE } from "./[memberId]/route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: {
      findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(),
    },
    session: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn(), findMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-team-1", email: "owner@x.com" };

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function setup(role: string, membershipRow?: Record<string, unknown> | null) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
  const mRow = membershipRow === undefined
    ? { id: "m1", userId: "u9", organizationId: "org_1", role: "report_viewer", status: "active", createdAt: new Date(), updatedAt: new Date(), user: { email: "m@x.com" } }
    : membershipRow;
  vi.mocked(prisma.organizationMembership.findUnique).mockResolvedValue(mRow as never);
  vi.mocked(prisma.organizationMembership.findMany).mockResolvedValue([mRow] as never);
  vi.mocked(prisma.organizationMembership.count).mockResolvedValue(2 as never);
}

describe("team member routes", () => {
  beforeEach(() => { vi.stubEnv("APP_MODE", "prod"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("GET lists members for team.view roles", async () => {
    setup("asset_manager");
    const res = await GET(req("/api/v1/team/members", "GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).members).toHaveLength(1);
  });

  it("GET is 403 for report_viewer and 400 for a bad status filter", async () => {
    setup("report_viewer");
    expect((await GET(req("/api/v1/team/members", "GET"))).status).toBe(403);
    setup("asset_manager");
    expect((await GET(req("/api/v1/team/members?status=weird", "GET"))).status).toBe(400);
  });

  it("PATCH is 403 for asset_manager and 200 for owner", async () => {
    setup("asset_manager");
    expect((await PATCH(req("/api/v1/team/members/m1", "PATCH", { role: "scan_operator" }))).status).toBe(403);
    setup("organization_owner");
    const res = await PATCH(req("/api/v1/team/members/m1", "PATCH", { role: "scan_operator" }));
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("scan_operator");
  });

  it("PATCH is 400 for an invalid role and 404 for an unknown member", async () => {
    setup("organization_owner");
    expect((await PATCH(req("/api/v1/team/members/m1", "PATCH", { role: "superadmin" }))).status).toBe(400);
    setup("organization_owner", null);
    expect((await PATCH(req("/api/v1/team/members/missing", "PATCH", { role: "scan_operator" }))).status).toBe(404);
  });

  it("DELETE is 403 for asset_manager, 404 unknown, 204 for owner", async () => {
    setup("asset_manager");
    expect((await DELETE(req("/api/v1/team/members/m1", "DELETE"))).status).toBe(403);
    setup("organization_owner", null);
    expect((await DELETE(req("/api/v1/team/members/missing", "DELETE"))).status).toBe(404);
    setup("organization_owner");
    expect((await DELETE(req("/api/v1/team/members/m1", "DELETE"))).status).toBe(204);
  });
});
```

- [ ] **Step 7: Run route test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/app/api/v1/team/members/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add portal/src/lib/org/team.ts portal/src/lib/org/team.test.ts portal/src/app/api/v1/team
git commit -m "feat(portal): team management API (list/role/remove, last-owner guard, revoke on removal)"
```

---

## Task 8: Sessions API

**Files:**
- Create: `portal/src/app/api/v1/sessions/route.ts`
- Create: `portal/src/app/api/v1/sessions/[sessionId]/revoke/route.ts`
- Test: `portal/src/app/api/v1/sessions/route.test.ts`

**Interfaces:**
- Consumes: `listActiveSessions`, `getSession`, `revokeSession` (Task 4), `can()` `team.view`/`session.revoke`.
- Produces: `GET /api/v1/sessions` (gate `team.view`) → `{ sessions }`; `POST /api/v1/sessions/[sessionId]/revoke` → 404 unknown, 403 when not self and lacking `session.revoke`, 200 with revoked session.

- [ ] **Step 1: Write the failing route test**

Create `portal/src/app/api/v1/sessions/route.test.ts` (same mock pattern; session model is the star here):
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { GET } from "./route";
import { POST } from "./[sessionId]/revoke/route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-sess-1", email: "owner@x.com" };

const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: "s1", organizationId: "org_1", userId: "u9", tokenHash: "h", userAgent: "curl", ipHash: null,
  lastSeenAt: new Date(), createdAt: new Date(), revokedAt: null, revokedById: null, ...over,
});

function req(path: string, method: string) {
  return new NextRequest(`http://localhost${path}`, { method, headers: { Authorization: "Bearer a.b.c" } });
}

function setup(role: string, sessionOverrides?: Record<string, unknown> | null) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
  const row = sessionOverrides === undefined ? sessionRow() : sessionOverrides;
  vi.mocked(prisma.session.findUnique).mockResolvedValue(row as never);
  vi.mocked(prisma.session.findMany).mockResolvedValue([row] as never);
  vi.mocked(prisma.session.update).mockImplementation((() => Promise.resolve({ ...(row as object), revokedAt: new Date(), revokedById: "u1" })) as never);
}

describe("session routes", () => {
  beforeEach(() => { vi.stubEnv("APP_MODE", "prod"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("GET lists sessions for team.view roles, 403 for viewers", async () => {
    setup("report_viewer");
    expect((await GET(req("/api/v1/sessions", "GET"))).status).toBe(403);
    setup("security_admin");
    const res = await GET(req("/api/v1/sessions", "GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).sessions).toHaveLength(1);
  });

  it("revoke: 404 unknown session", async () => {
    setup("organization_owner", null);
    expect((await POST(req("/api/v1/sessions/nope/revoke", "POST"))).status).toBe(404);
  });

  it("revoke: a member may revoke their OWN session", async () => {
    setup("report_viewer", sessionRow({ userId: "u1" }));
    const res = await POST(req("/api/v1/sessions/s1/revoke", "POST"));
    expect(res.status).toBe(200);
    expect((await res.json()).revokedAt).not.toBeNull();
  });

  it("revoke: 403 when not self and not owner/security_admin", async () => {
    setup("report_viewer", sessionRow({ userId: "u9" }));
    expect((await POST(req("/api/v1/sessions/s1/revoke", "POST"))).status).toBe(403);
  });

  it("revoke: owner can revoke any session", async () => {
    setup("organization_owner", sessionRow({ userId: "u9" }));
    const res = await POST(req("/api/v1/sessions/s1/revoke", "POST"));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/app/api/v1/sessions/route.test.ts`
Expected: FAIL — module `./route` not found.

- [ ] **Step 3: Implement the routes**

Create `portal/src/app/api/v1/sessions/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listActiveSessions } from "@/lib/org/sessions";

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "team.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sessions = await listActiveSessions(ctx);
  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      userAgent: s.userAgent,
      lastSeenAt: s.lastSeenAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      revokedAt: s.revokedAt?.toISOString() ?? null,
    })),
  });
}
```

Create `portal/src/app/api/v1/sessions/[sessionId]/revoke/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { getSession, revokeSession } from "@/lib/org/sessions";

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sessionId } = await params;
  const session = await getSession(ctx, sessionId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const isOwn = session.userId === ctx.userId;
  if (!isOwn && !can(ctx, "session.revoke")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const revoked = await revokeSession(ctx, sessionId);
  return NextResponse.json({
    id: revoked!.id,
    userId: revoked!.userId,
    userAgent: revoked!.userAgent,
    lastSeenAt: revoked!.lastSeenAt.toISOString(),
    createdAt: revoked!.createdAt.toISOString(),
    revokedAt: revoked!.revokedAt?.toISOString() ?? null,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/app/api/v1/sessions/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/api/v1/sessions
git commit -m "feat(portal): sessions API (list + revoke, self or privileged)"
```

---

## Task 9: Audit trail API

**Files:**
- Modify: `portal/src/lib/audit.ts` (add `listAuditEvents`)
- Test: `portal/src/lib/audit.test.ts` (append cases)
- Create: `portal/src/app/api/v1/audit/route.ts`
- Test: `portal/src/app/api/v1/audit/route.test.ts`

**Interfaces:**
- Consumes: `recordAudit` (existing), `TenantContext`, `can()` `audit.view`.
- Produces:
  - `listAuditEvents(ctx: TenantContext, filter: { resourceType?: string; action?: string; limit?: number; cursor?: string }): Promise<{ events: AuditEvent[]; nextCursor: string | null }>` — org-scoped, newest first, take `limit` (default 50, max 100), cursor = last event id.
  - Route `GET /api/v1/audit` (gate `audit.view`; validate `limit` 1-100, `cursor` string).

- [ ] **Step 1: Write the failing test (append to `portal/src/lib/audit.test.ts`)**

```ts
import { listAuditEvents } from "@/lib/audit";

describe("listAuditEvents", () => {
  it("lists org events newest-first and filters by action/resourceType", async () => {
    // audit.test.ts already seeds org_audit_0001 + a recordAudit call; reuse its ctx.
    const all = await listAuditEvents(ctx, {});
    expect(all.events.length).toBeGreaterThanOrEqual(1);
    const filtered = await listAuditEvents(ctx, { action: "test.audit" });
    expect(filtered.events.every((e) => e.action === "test.audit")).toBe(true);
  });

  it("paginates with cursor and caps limit at 100", async () => {
    const page1 = await listAuditEvents(ctx, { limit: 1 });
    expect(page1.events).toHaveLength(1);
    if (page1.nextCursor) {
      const page2 = await listAuditEvents(ctx, { limit: 1, cursor: page1.nextCursor });
      expect(page2.events.length).toBeGreaterThanOrEqual(0);
      expect(page2.events[0]?.id).not.toBe(page1.events[0].id);
    }
    await expect(listAuditEvents(ctx, { limit: 500 })).rejects.toThrow(/limit/);
  });

  it("is tenant-scoped: another org sees none of our events", async () => {
    const other: TenantContext = { userId: "u-other", organizationId: "org_audit_0002", role: "organization_owner", isStaff: false, appMode: "prod" };
    const result = await listAuditEvents(other, { action: "test.audit" });
    expect(result.events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/audit.test.ts`
Expected: FAIL — `listAuditEvents` not exported.

- [ ] **Step 3: Implement `listAuditEvents`**

In `portal/src/lib/audit.ts`, append:
```ts
export interface AuditFilter {
  resourceType?: string;
  action?: string;
  limit?: number;
  cursor?: string;
}

export async function listAuditEvents(
  ctx: TenantContext,
  filter: AuditFilter = {}
): Promise<{ events: AuditEvent[]; nextCursor: string | null }> {
  const limit = filter.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  return prisma.$transaction(async (tx) => {
    await setRlsContext(ctx.organizationId, tx);
    const events = await tx.auditEvent.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(filter.resourceType ? { resourceType: filter.resourceType } : {}),
        ...(filter.action ? { action: filter.action } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor } } : {}),
    });
    const hasMore = events.length > limit;
    const page = hasMore ? events.slice(0, limit) : events;
    return { events: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  });
}
```

Add `AuditEvent` to the imports from `@/lib/generated/prisma` in audit.ts.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the route**

Create `portal/src/app/api/v1/audit/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listAuditEvents } from "@/lib/audit";

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "audit.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const limit = sp.get("limit") ? Number(sp.get("limit")) : 50;
  const cursor = sp.get("cursor") ?? undefined;
  try {
    const { events, nextCursor } = await listAuditEvents(ctx, {
      action: sp.get("action") ?? undefined,
      resourceType: sp.get("resourceType") ?? undefined,
      limit,
      cursor,
    });
    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        actorUserId: e.actorUserId,
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 6: Write the failing route test**

Create `portal/src/app/api/v1/audit/route.test.ts` (mock pattern; add `auditEvent.findMany` to the txMock returning one row; assert 403 for `report_viewer`, 400 for `limit=500`, 200 for `security_admin`).

- [ ] **Step 7: Run route test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/app/api/v1/audit/route.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add portal/src/lib/audit.ts portal/src/lib/audit.test.ts portal/src/app/api/v1/audit
git commit -m "feat(portal): audit trail API (org-scoped list, filters, cursor pagination)"
```

---

## Task 10: User center UI (functional baseline)

**Files:**
- Create: `portal/src/app/(dashboard)/settings/page.tsx`, `team/page.tsx`, `access/page.tsx`, `audit/page.tsx`
- Create: `portal/src/components/dashboard/OrgProfileForm.tsx`, `TeamTable.tsx`, `MemberInviteForm.tsx`, `SessionTable.tsx`, `AuditTable.tsx`
- Modify: `portal/src/components/dashboard/sidebar.tsx`

**Interfaces:**
- Consumes: the Task 6-9 routes + existing `POST /api/v1/invitations` + `tenantContextFromRequest` server-page pattern (see `(dashboard)/api-keys/page.tsx`).
- Produces: functional pages that any member can view and owners can edit. **This is the UI baseline the handoff stream (Codex / a UI dev) extends — not pixel work.**

- [ ] **Step 1: Sidebar navigation**

In `portal/src/components/dashboard/sidebar.tsx`, extend `navigation` (after "API Keys"):
```ts
  { name: "Team", href: "/team" },
  { name: "Access", href: "/access" },
  { name: "Audit", href: "/audit" },
  { name: "Settings", href: "/settings" },
```

- [ ] **Step 2: Team page + components**

`portal/src/app/(dashboard)/team/page.tsx` (server component, api-keys page pattern):
```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listTeamMembers } from "@/lib/org/team";
import { TeamTable } from "@/components/dashboard/TeamTable";
import { MemberInviteForm } from "@/components/dashboard/MemberInviteForm";

export default async function TeamPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const canManage = can(ctx, "team.manage");
  const members = (await listTeamMembers(ctx)).map((m) => ({ ...m, joinedAt: m.joinedAt?.toISOString() ?? null }));
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team</h1>
          <p className="text-gray-600">Members, roles, and invitations for this organization.</p>
        </div>
        {canManage && <MemberInviteForm />}
      </div>
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <TeamTable members={members} canManage={canManage} currentUserId={ctx.userId} />
      </div>
    </div>
  );
}
```

`portal/src/components/dashboard/TeamTable.tsx` (client):
```tsx
"use client";

import { useRouter } from "next/navigation";

export interface TeamMemberRow {
  id: string;
  userId: string;
  email: string;
  role: string;
  status: string;
  joinedAt: string | null;
}

const ROLES = ["organization_owner", "security_admin", "asset_manager", "scan_operator", "report_viewer", "billing_admin"];

export function TeamTable({ members, canManage, currentUserId }: { members: TeamMemberRow[]; canManage: boolean; currentUserId: string }) {
  const router = useRouter();
  async function changeRole(memberId: string, role: string) {
    const res = await fetch(`/api/v1/team/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (res.ok) router.refresh();
  }
  async function remove(memberId: string) {
    if (!confirm("Remove this member? Their sessions will be revoked.")) return;
    const res = await fetch(`/api/v1/team/members/${memberId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }
  return (
    <table className="min-w-full divide-y divide-gray-200 text-sm">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
          {canManage && <th className="px-4 py-2" />}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {members.map((m) => (
          <tr key={m.id}>
            <td className="px-4 py-2">{m.email}</td>
            <td className="px-4 py-2">
              {canManage ? (
                <select
                  className="border border-gray-300 rounded px-2 py-1"
                  value={m.role}
                  onChange={(e) => changeRole(m.id, e.target.value)}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                m.role
              )}
            </td>
            <td className="px-4 py-2">{m.status}</td>
            {canManage && (
              <td className="px-4 py-2 text-right">
                {m.userId !== currentUserId && (
                  <button onClick={() => remove(m.id)} className="text-red-600 hover:text-red-800">Remove</button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`portal/src/components/dashboard/MemberInviteForm.tsx` (client; reuses the existing invitations route):
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLES = ["organization_owner", "security_admin", "asset_manager", "scan_operator", "report_viewer", "billing_admin"];

export function MemberInviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("security_admin");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/v1/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (res.ok) {
      setEmail("");
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Invitation failed");
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="email" required placeholder="colleague@example.com" value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
      />
      <select value={role} onChange={(e) => setRole(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-sm">
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <button type="submit" className="bg-indigo-600 text-white rounded px-4 py-2 text-sm">Invite</button>
      {error && <span className="text-red-600 text-sm">{error}</span>}
    </form>
  );
}
```

- [ ] **Step 3: Access page + SessionTable**

`portal/src/app/(dashboard)/access/page.tsx` (server; lists sessions via the sessions service directly, like api-keys page lists keys):
```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { tenantContextFromRequest } from "@/lib/tenant";
import { listActiveSessions } from "@/lib/org/sessions";
import { SessionTable } from "@/components/dashboard/SessionTable";

export default async function AccessPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const sessions = (await listActiveSessions(ctx)).map((s) => ({
    id: s.id,
    userId: s.userId,
    userAgent: s.userAgent ?? "unknown",
    lastSeenAt: s.lastSeenAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    isCurrent: false,
  }));
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Access</h1>
          <p className="text-gray-600">Active sessions. Revoking a session forces a fresh login.</p>
        </div>
        <Link href="/api-keys" className="bg-indigo-600 text-white rounded px-4 py-2 text-sm">Manage API keys</Link>
      </div>
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <SessionTable sessions={sessions} currentUserId={ctx.userId} />
      </div>
    </div>
  );
}
```

`portal/src/components/dashboard/SessionTable.tsx` (client):
```tsx
"use client";

import { useRouter } from "next/navigation";

export interface SessionRow {
  id: string;
  userId: string;
  userAgent: string;
  lastSeenAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export function SessionTable({ sessions, currentUserId }: { sessions: SessionRow[]; currentUserId: string }) {
  const router = useRouter();
  async function revoke(id: string) {
    if (!confirm("Revoke this session? The user will be signed out.")) return;
    const res = await fetch(`/api/v1/sessions/${id}/revoke`, { method: "POST" });
    if (res.ok) router.refresh();
  }
  if (sessions.length === 0) return <p className="text-gray-500 text-sm">No active sessions.</p>;
  return (
    <table className="min-w-full divide-y divide-gray-200 text-sm">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">User agent</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last seen</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {sessions.map((s) => (
          <tr key={s.id}>
            <td className="px-4 py-2">{s.userAgent}{s.userId === currentUserId ? <span className="ml-2 text-xs text-indigo-600">you</span> : null}</td>
            <td className="px-4 py-2">{new Date(s.lastSeenAt).toLocaleString()}</td>
            <td className="px-4 py-2 text-right">
              <button onClick={() => revoke(s.id)} className="text-red-600 hover:text-red-800">Revoke</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Settings page + OrgProfileForm**

`portal/src/app/(dashboard)/settings/page.tsx` (server):
```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { getOrgProfile } from "@/lib/org/profile";
import { OrgProfileForm } from "@/components/dashboard/OrgProfileForm";

export default async function SettingsPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  const profile = await getOrgProfile(ctx);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600">Organization profile and security contacts.</p>
      </div>
      {profile.parentName && (
        <p className="text-sm text-gray-500">Parent organization: <strong>{profile.parentName}</strong></p>
      )}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <OrgProfileForm
          name={profile.name}
          contacts={profile.contacts.map((c) => ({ id: c.id, type: c.type, name: c.name, email: c.email, phone: c.phone, escalationOrder: c.escalationOrder }))}
          canManage={can(ctx, "org.manage")}
        />
      </div>
    </div>
  );
}
```

`portal/src/components/dashboard/OrgProfileForm.tsx` (client):
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ContactRow {
  id?: string;
  type: string;
  name: string;
  email: string;
  phone: string | null;
  escalationOrder: number;
}

const TYPES = ["business", "security", "billing", "emergency"];

export function OrgProfileForm({ name, contacts, canManage }: { name: string; contacts: ContactRow[]; canManage: boolean }) {
  const router = useRouter();
  const [orgName, setOrgName] = useState(name);
  const [rows, setRows] = useState<ContactRow[]>(contacts);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/v1/org", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: orgName,
        contacts: rows.map(({ id, type, name, email, phone, escalationOrder }) => ({ id, type, name, email, phone, escalationOrder })),
      }),
    });
    if (res.ok) { setSaved(true); router.refresh(); }
    else { const b = await res.json().catch(() => ({})); setError(b.error ?? "Save failed"); }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700">Organization name</label>
        <input
          value={orgName} disabled={!canManage}
          onChange={(e) => setOrgName(e.target.value)}
          className="mt-1 border border-gray-300 rounded px-3 py-2 text-sm w-full max-w-md"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Security & notification contacts</label>
        <div className="mt-2 space-y-2">
          {rows.map((c, i) => (
            <div key={c.id ?? i} className="flex gap-2 items-center text-sm">
              <select
                value={c.type} disabled={!canManage}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, type: e.target.value } : r)))}
                className="border border-gray-300 rounded px-2 py-1"
              >
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input
                placeholder="Name" value={c.name} disabled={!canManage}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                className="border border-gray-300 rounded px-2 py-1"
              />
              <input
                type="email" placeholder="Email" value={c.email} disabled={!canManage}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))}
                className="border border-gray-300 rounded px-2 py-1"
              />
            </div>
          ))}
        </div>
        {canManage && (
          <button type="button" onClick={() => setRows([...rows, { type: "security", name: "", email: "", phone: null, escalationOrder: rows.length + 1 }])}
            className="mt-2 text-sm text-indigo-600">+ Add contact</button>
        )}
      </div>
      {canManage && (
        <div className="flex items-center gap-3">
          <button type="submit" className="bg-indigo-600 text-white rounded px-4 py-2 text-sm">Save</button>
          {saved && <span className="text-green-600 text-sm">Saved</span>}
          {error && <span className="text-red-600 text-sm">{error}</span>}
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 5: Audit page + AuditTable**

`portal/src/app/(dashboard)/audit/page.tsx` (server):
```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { listAuditEvents } from "@/lib/audit";
import { AuditTable } from "@/components/dashboard/AuditTable";

export default async function AuditPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  if (!can(ctx, "audit.view")) redirect("/dashboard");
  const { events } = await listAuditEvents(ctx, { limit: 50 });
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit trail</h1>
        <p className="text-gray-600">Append-only record of security-relevant actions.</p>
      </div>
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <AuditTable
          events={events.map((e) => ({
            id: e.id, action: e.action, resourceType: e.resourceType,
            resourceId: e.resourceId, actorUserId: e.actorUserId, reason: e.reason,
            createdAt: e.createdAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
```

`portal/src/components/dashboard/AuditTable.tsx` (client, read-only table):
```tsx
"use client";

export interface AuditRow {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorUserId: string | null;
  reason: string | null;
  createdAt: string;
}

export function AuditTable({ events }: { events: AuditRow[] }) {
  if (events.length === 0) return <p className="text-gray-500 text-sm">No events yet.</p>;
  return (
    <table className="min-w-full divide-y divide-gray-200 text-sm">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">When</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actor</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {events.map((e) => (
          <tr key={e.id}>
            <td className="px-4 py-2 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
            <td className="px-4 py-2 font-mono text-xs">{e.action}</td>
            <td className="px-4 py-2">{e.resourceType}{e.resourceId ? `:${e.resourceId}` : ""}</td>
            <td className="px-4 py-2">{e.actorUserId ?? "system"}</td>
            <td className="px-4 py-2">{e.reason ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 6: Verify the app still builds for tests**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run`
Expected: PASS — full suite green (UI pages are untested by convention, consistent with the existing dashboard pages).

- [ ] **Step 7: Commit**

```bash
git add portal/src/app/\(dashboard\)/settings portal/src/app/\(dashboard\)/team portal/src/app/\(dashboard\)/access portal/src/app/\(dashboard\)/audit portal/src/components/dashboard portal/src/components/dashboard/sidebar.tsx
git commit -m "feat(portal): user center UI baseline (settings, team, access, audit) + sidebar nav"
```

---

## Task 11: Exit criteria + handoff pack

**Files:**
- Create: `portal/src/lib/org/exit.test.ts`
- Modify: `AGENTS.md` (project state + NEXT line)

**Interfaces:**
- Consumes: everything from Tasks 2-10 + `portal/spec/openapi.yaml`.
- Produces: the exit proof + the handoff pack definition.

- [ ] **Step 1: Write the exit criteria test**

Create `portal/src/lib/org/exit.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { getOrgProfile, updateOrgProfile } from "@/lib/org/profile";
import { listTeamMembers, updateMemberRole, removeMember } from "@/lib/org/team";
import { recordSessionAccess, revokeSession, listActiveSessions, hashToken, isSessionBlocked } from "@/lib/org/sessions";
import { recordAudit, listAuditEvents } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG_A = "org_uc_exit_a_001";
const ORG_B = "org_uc_exit_b_001";
const OWNER_A = "user_uc_exit_owner_a";
const MEMBER_B = "user_uc_exit_member_b";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctxA: TenantContext = { userId: OWNER_A, organizationId: ORG_A, role: "organization_owner", isStaff: false, appMode: "prod" };
const ctxB: TenantContext = { userId: MEMBER_B, organizationId: ORG_B, role: "organization_owner", isStaff: false, appMode: "prod" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG_A, ORG_B]) {
      await admin.query(`DELETE FROM "Session" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "OrganizationMembership" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Contact" WHERE "organizationId" = $1`, [o]);
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id IN ($1, $2)`, [OWNER_A, MEMBER_B]);
  } finally { await admin.end(); }
}

describe("user center exit criteria", () => {
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG_A, ORG_B]) await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Exit ${o}` } }));
    await withTenant(ORG_A, (tx) => tx.user.create({ data: { id: OWNER_A, idpId: "kc-exit-a", email: "a@x.com" } }));
    await withTenant(ORG_B, (tx) => tx.user.create({ data: { id: MEMBER_B, idpId: "kc-exit-b", email: "b@x.com" } }));
    await withTenant(ORG_A, (tx) => tx.organizationMembership.create({ data: { userId: OWNER_A, organizationId: ORG_A, role: "organization_owner" } }));
    await withTenant(ORG_B, (tx) => tx.organizationMembership.create({ data: { userId: MEMBER_B, organizationId: ORG_B, role: "organization_owner" } }));
    await updateOrgProfile(ctxA, { name: "Exit Org A", contacts: [{ type: "security", name: "A", email: "sec@a.com" }] });
    await recordSessionAccess(ctxA, { tokenHash: hashToken("exit-tok") });
    await recordAudit(ctxA, "exit.test", "Test", "exit-1");
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("org B never sees org A's profile, members, sessions, or audit events", async () => {
    const profileB = await getOrgProfile(ctxB);
    expect(profileB.name).toBe("Exit org_uc_exit_b_001");
    expect(profileB.contacts.some((c) => c.email === "sec@a.com")).toBe(false);
    expect((await listTeamMembers(ctxB)).some((m) => m.email === "a@x.com")).toBe(false);
    expect((await listActiveSessions(ctxB)).some((s) => s.tokenHash === hashToken("exit-tok"))).toBe(false);
    expect((await listAuditEvents(ctxB, { action: "exit.test" })).events).toHaveLength(0);
    expect(await isSessionBlocked(ORG_B, hashToken("exit-tok"))).toBe(false);
  });

  it("org B cannot mutate org A's members", async () => {
    const memberA = (await listTeamMembers(ctxA)).find((m) => m.userId === OWNER_A)!;
    expect(await updateMemberRole(ctxB, memberA.id, "report_viewer")).toBeNull();
    expect(await removeMember(ctxB, memberA.id)).toBe(false);
  });

  it("revoking a session flips the blocked flag and removes it from the active list", async () => {
    const session = (await listActiveSessions(ctxA)).find((s) => s.tokenHash === hashToken("exit-tok"))!;
    await revokeSession(ctxA, session.id, "exit test");
    expect(await isSessionBlocked(ORG_A, hashToken("exit-tok"))).toBe(true);
    expect((await listActiveSessions(ctxA)).some((s) => s.id === session.id)).toBe(false);
  });

  it("every user-center contract path is implemented by a matching route", async () => {
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
    const userCenterPaths = Object.keys(spec.paths).filter((p) =>
      /^\/(org|team|sessions|audit|invitations)(\/|$)/.test(p)
    );
    expect(userCenterPaths.length).toBeGreaterThanOrEqual(6);
    for (const p of userCenterPaths) {
      const segments = p.split("/").filter(Boolean).map((s) => (s.startsWith("{") ? "[id]" : s));
      const expected = path.join(routeDir, ...segments.slice(0, -1), "route.ts");
      expect(routeFiles.has(expected), `no route file for ${p}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the exit test + full suite**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run`
Expected: PASS — all tests including the 4 exit criteria.

- [ ] **Step 3: Update AGENTS.md**

Replace the `- **NEXT:** Phase 3 = versioned scope & authorization ...` line with:

```markdown
- **User Center DONE** (hub): org profile + contacts, team management (members/roles/removal w/ last-owner guard), session registry (hash-only tokens, revoke = blocked at auth), audit trail API + UI baseline (`/settings`, `/team`, `/access`, `/audit`). API contract: `portal/spec/openapi.yaml` (org/team/sessions/audit/invitations) — handoff artifact for the UI stream (Codex / UI dev).
- **NEXT:** Scans + Scan Reports (per user reorder 2026-08-31; full Phase 3 versioned scope/attestation follows).
```

Update the test count line to the fresh suite result. Update the follow-ups list: drop "cookie-session auth" phrasing to "bind cookie session ids into the Session registry (registry is ready)".

- [ ] **Step 4: Commit**

```bash
git add portal/src/lib/org/exit.test.ts AGENTS.md
git commit -m "test(portal): user center exit criteria + docs: handoff-ready contract"
```

---

## Self-Review

**Spec coverage:** §2 control-plane ownership of orgs/memberships/sessions → Tasks 3-8; §3 memberships + roles + QSA nesting → Tasks 6-7 (+ parent org shown read-only); §4 `Organization`/`User`/`OrganizationMembership`/`Contact`/`AuditEvent`/`ApiKey` → Tasks 6-9 (ApiKey UI is pre-existing); §7.1 Keycloak session IdP → Task 5 keeps Bearer auth, registry pre-wires session ids. User directive (hub + contract + UI handoff) → Tasks 1, 10, 11. Deferred (documented): human session token binding to the Keycloak cookie flow (follow-up), contact deletion, org transfer/leave flows, billing.

**Placeholder scan:** every step carries code or an exact command; no TBD/TODO. Task 9's route test references "mock pattern" — its code is specified via the Task 8 template + Step 6 instruction to mirror Task 8's test with `auditEvent.findMany` (the exact assertions are enumerated in the step text).

**Type consistency:** `hashToken`/`recordSessionAccess`/`listActiveSessions`/`getSession`/`revokeSession`/`isSessionBlocked`/`sessionMetaFromRequest` defined in Task 4 and used identically in Tasks 5, 7, 8, 11. `TeamGuardError` defined Task 7, used Task 7 tests. `Member` shape (`id/userId/email/role/status/joinedAt`) consistent between Task 7 service and UI (Task 10 `TeamMemberRow`). RBAC action names from Task 2 used verbatim in Tasks 6-9 routes.

## Handoff pack for the UI stream (Codex / UI dev)

When Tasks 1-11 are done, the handoff artifact is:
1. **The contract** — `portal/spec/openapi.yaml` (user-center paths: /org, /team/members, /team/members/{memberId}, /sessions, /sessions/{sessionId}/revoke, /audit, /invitations).
2. **The working UI baseline** — `/settings`, `/team`, `/access`, `/audit` pages + components (functional, Tailwind-styled, fetch the same contract).
3. **The plan** — this file.
A UI stream can build/extend pages purely against the contract; the backend (RLS, RBAC, session enforcement) is already proven by the exit tests.
