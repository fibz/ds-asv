# 02 — Conventions

This chapter is the "how we build things" reference. When you implement a task, follow these patterns — reviewers will check for them.

## The development loop (TDD, always)

Every task follows the same loop:

1. **Write the failing test** that describes the behavior you want
2. **Run it and confirm it fails** (for the right reason — e.g. "module not found")
3. **Write the minimal implementation** to make it pass
4. **Run the focused test, then the full suite**
5. **Commit** with a conventional message

```bash
# Focused while iterating
npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/org/team.test.ts
# Full suite before committing
npx --cache /home/cchock/projects/.npm-cache vitest run
```

Commit messages follow `type(scope): summary` — e.g. `feat(portal): team management API (list/role/remove, last-owner guard)`, `fix(portal): ...`, `test(portal): ...`, `docs: ...`.

## Recipe: add a new tenant table (the RLS migration)

This is the single most repeated pattern. A tenant table = a Prisma model carrying `organizationId`, **plus** RLS + grants in the **same migration**.

**1. Add the model to `portal/prisma/schema.prisma`:**

```prisma
model Thing {
  id             String       @id @default(cuid())
  organizationId String
  ...fields...
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
}
```

Add `things Thing[]` to the `Organization` model's relations.

**2. Generate the migration with Prisma 7's workflow** (never `migrate dev`):

```bash
cd portal
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > /tmp/m.sql
mkdir -p prisma/migrations/<timestamp>_<name>
cp /tmp/m.sql prisma/migrations/<timestamp>_<name>/migration.sql
```

> **Why `--from-config-datasource`?** Prisma 7.10 removed `--from-url`. `prisma.config.ts` pins the admin datasource, so this flag diffs against the live admin DB.

**3. Append the RLS + grants to the same migration file** (fail-closed pattern):

```sql
ALTER TABLE "Thing" ENABLE ROW LEVEL SECURITY;
CREATE POLICY thing_tenant_isolation ON "Thing"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON "Thing" TO asv_app;
```

(No DELETE grant unless the spec explicitly wants deletion — tenant history is preserved, never deleted.)

**4. Deploy + regenerate:**

```bash
npx prisma migrate deploy
npx prisma generate
```

> ⚠️ **The `Asset_active_unique` trap:** after any `migrate diff`, check that the partial unique index `Asset_active_unique` (`"organizationId","type","canonicalIdentifier"` `WHERE "lifecycleState" <> 'retired'`) is still in the generated migration. `migrate diff` sometimes drops it as "drift" because partial indexes can't be expressed in `schema.prisma`. If it's gone, re-append the `CREATE UNIQUE INDEX` SQL from migration `20260830000002_phase2_assets`.

**5. Prove RLS with a test** — see "Test conventions" below (`asv_app` insert without context → `42501`; with context → success; DELETE → `permission denied`).

## Service-layer pattern

Business logic lives in **services** under `portal/src/lib/`, not in the route files. A service:

- Takes `ctx: TenantContext` as its first argument
- Derives `organizationId` from `ctx` only
- Wraps every DB access in `withTenant(ctx.organizationId, ...)` (see 01)
- Writes audit events via `recordAudit(ctx, action, resourceType, resourceId?, before?, after?, reason?, tx?)` — append-only, inside the same transaction
- Throws typed errors for domain rules (e.g. `ScanGuardError`, `TeamGuardError`), returns `null` for "not found"

```ts
// portal/src/lib/org/team.ts — the shape to copy
export async function updateMemberRole(ctx: TenantContext, memberId: string, role: string): Promise<Member | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const membership = await tx.organizationMembership.findUnique({ where: { id: memberId }, include: { user: true } });
    if (!membership || membership.organizationId !== ctx.organizationId) return null;
    // ...validate, guard, update...
    await recordAudit(ctx, "member.role.updated", "OrganizationMembership", memberId, { role: membership.role }, { role }, undefined, tx);
    return { ... };
  });
}
```

## RBAC

Roles: `organization_owner`, `security_admin`, `asset_manager`, `scan_operator`, `report_viewer`, `billing_admin`.

- `can(ctx, "action")` — permission check; **relaxed outside prod** (that's by design — see APP_MODE).
- `requireRole(ctx, ...roles)` / `hasRole(...)` — strict role checks, not relaxed.

**Adding a new action:** extend `can()` in `portal/src/lib/auth/rbac.ts` and add a matrix test in `rbac.test.ts`. Existing actions include `asset.manage`, `api-key.manage`, `member.invite`, `team.view`, `team.manage`, `session.revoke`, `audit.view`, `org.view`, `org.manage`, `scan.run`, `report.view`.

## API route pattern

Routes live at `portal/src/app/api/v1/...`. The shape every route follows:

```ts
export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "some.action")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // validate input → 400 with a clean message
  // call the service → map null → 404
  // wrap service calls that can throw in routeErrorResponse(err)
}
```

**Error mapping** (shared helper `portal/src/lib/http-error.ts`):

| Situation | Status |
|---|---|
| Validation (route pre-checks) | `400` with a clean message |
| Domain guard error (`XGuardError`) | `409` Conflict |
| Genuine not-found (exact message match) | `404` |
| Anything else | `console.error` + `500` "Internal server error" — **never echo raw error messages to clients** |

Dynamic segment handlers use the Next 16 convention: `{ params }: { params: Promise<{ scanId: string }> }` and `const { scanId } = await params;`.

Every new endpoint is documented in `portal/spec/openapi.yaml` **first** (contract-first — the spec is the source of truth; an exit test enforces spec ↔ route conformance).

## Test conventions

Two test styles, both important:

**1. Real-DB service tests** (prove behavior against actual PostgreSQL + RLS):
- Fixed ids per suite (e.g. `org_team_0001`, `user_team_owner_01`) — **unique repo-wide** so parallel vitest workers never collide
- `beforeAll`: scoped admin wipe via a `pg.Client` from `ADMIN_DATABASE_URL`, then seed with `withTenant`
- `afterAll`: same scoped wipe — **never global `DELETE FROM ...`** (parallel workers share the DB)
- The RLS proof: an uncontexted `prisma.$executeRawUnsafe` insert rejects with `42501`; the same insert inside `withTenant` succeeds; a `DELETE` rejects with `permission denied`

**2. Mocked route tests** (prove HTTP status/behavior fast):
- `vi.mock("jose", ...)` to stub JWT verification
- `vi.mock("@/lib/prisma-client", ...)` with a txMock whose `$transaction(fn)` calls `fn(txMock)` — include `session: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() }` (the auth path touches it)
- `vi.stubEnv("APP_MODE", "prod")` in `beforeEach` so `can()` gates bite; also stub `KEYCLOAK_ISSUER`/`KEYCLOAK_CLIENT_ID`
- Assert status codes and response shapes, e.g. `403` for a non-privileged role, `404` for unknown ids

**When adding tests, remember:** they must verify real behavior — a test that would pass even if the code were broken is worse than no test. Reviewers check for vacuous assertions.

## UI page pattern

Dashboard pages are **server components** that call the service layer directly (they don't fetch their own API):

```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { tenantContextFromRequest } from "@/lib/tenant";

export default async function MyPage() {
  const ctx = await tenantContextFromRequest({ headers: await headers() });
  if (!ctx) redirect("/sign-in");
  // optional: if (!can(ctx, "some.view")) redirect("/dashboard");
  const data = await someService(ctx);
  return (/* JSX */);
}
```

Interactive pieces (forms, tables that mutate) are **client components** (`"use client"`) that `fetch()` the API and `router.refresh()` on success, showing `body.error` on failure.

## Audit events

`recordAudit` is the **only** write path for `AuditEvent` — append-only, no update/delete exposed. Use actions like `asset.retire`, `member.role.updated`, `session.revoked`, `scan.created`, `report.attested`. Audit writes belong **inside the same transaction** as the action they record.
