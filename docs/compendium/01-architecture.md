# 01 — Architecture

This chapter explains how the pieces fit together and, in particular, **how tenant isolation actually works** — because that's the part that will bite you.

## Control plane / scanner split

```
┌──────────────────────────── Control plane (portal/) ─────────────────────────┐
│  Next.js App Router + PostgreSQL (RLS)                                        │
│  ├─ Keycloak session auth (Bearer JWT) + X-API-Key for machines               │
│  ├─ Organization / membership / teams   (the user center)                     │
│  ├─ Asset inventory + verification                                            │
│  ├─ Scans: create from selected assets → issue signed expiring manifest       │
│  ├─ Findings, Reports, QA attestation, Audit                                  │
│  └─ issues signed scan-job manifest ──────┐                                   │
└───────────────────────────────────────────│───────────────────────────────────┘
                                    signed, expiring manifest
┌──────────────────────────── Scanner service (scanner/) ──▼──────────────────┐
│  Python/FastAPI + Celery      Vault · MinIO · nmap/testssl                  │
│  ├─ blackbox connector (nmap + testssl)                                     │
│  ├─ CVSS/PCI scoring engine ──▶ self-hosted NVD/CVE DB                      │
│  └─ writes findings/evidence back to the shared Postgres                    │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Key idea:** the control plane owns all customer data and decisions. The scanner is a worker that receives a *minimal, expiring* description of what to scan — never the customer's whole dataset.

## The database roles (critical)

There are exactly two ways to talk to the database:

| Role | Used by | Bypasses RLS? | Purpose |
|---|---|---|---|
| `asv_app` | App code (`DATABASE_URL`) | ❌ Never | All tenant data access; RLS is always ON |
| `asv` | Prisma CLI, migrations, test seeding/cleanup (`ADMIN_DATABASE_URL`) | ✅ Yes | DDL, admin tasks |

Rules that follow:
- **App code only ever connects as `asv_app`.** Tenant DML must never run as `asv`.
- `asv` is used for migrations and for *scoped* test cleanup (never for tenant reads/writes).
- A migration that creates a tenant table **must** grant `asv_app` the minimum privileges it needs — typically `SELECT, INSERT, UPDATE` and **no DELETE** (tenant history is never deleted).

## Row-Level Security (RLS) — how isolation really works

Every tenant table carries an `organizationId` column. RLS is a **PostgreSQL-level filter**: a row is only visible/insertable if its `organizationId` equals the current session's `app.tenant_id`.

### The transaction-scoped context

The tenant context is set with:

```sql
SELECT set_config('app.tenant_id', '<org-id>', true);
```

The third argument (`true`) makes it **transaction-scoped**: it only applies to queries running on the *same connection inside the same transaction*. This is why you'll see this pattern everywhere in the codebase:

```ts
function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(organizationId, tx);
    return fn(tx);
  });
}
```

> ⚠️ **Watch out:** calling `setRlsContext` *without* a transaction client, or running a query on the pool client instead of the `tx` client, means the context silently doesn't apply — and your "tenant-scoped" query may return **another tenant's rows** (or, more often, fail closed with `42501` "new row violates row-level security"). Always use the `tx` client.

### Where `organizationId` comes from

Never from the URL, request body, or client input. It is **derived from authenticated identity**:

```
Request (Authorization: Bearer <Keycloak JWT>)
  → tenantContextFromRequest(request)   // verifies JWT, provisions the user
  → resolveTenantContext(userId)        // looks up the user's membership
  → TenantContext { userId, organizationId, role, appMode, isStaff }
```

Every service function takes `ctx` and derives the org from it. If you find yourself reading `organizationId` out of a request body — stop, that's a tenant-isolation bug.

## The data model, mapped

```
Organization (tenant)  ──1:N──  OrganizationMembership ──N:1── User
      │                        (user ↔ org, with role)
      ├── Contact              (business/security/billing/emergency contacts)
      ├── Invitation           (single-use, expiring)
      ├── ApiKey               (machine access, salted hash)
      ├── AuditEvent           (append-only history — never updated/deleted)
      ├── Asset                (durable inventory: IP/CIDR/FQDN)
      ├── AssetVerification    (ownership evidence)
      ├── Session              (login registry — hash-only tokens, revocable)
      ├── Scan                 (a scan run: PENDING → RUNNING → COMPLETED/FAILED)
      ├── ScanTarget           (immutable per-scan snapshot of selected assets)
      ├── Finding              (a vulnerability on a target: qid/severity/CVE)
      └── Report (+ ReportAttestation)  (Qualys-style report, QA gate)
```

The `Organization` model has `parentOrgId` for QSA nesting — a merchant's parent is its QSA. Nested orgs share one isolation boundary (each row still carries its own `organizationId`).

## Authentication model

| Surface | Mechanism |
|---|---|
| Human users (portal UI) | **Keycloak** (self-hosted OIDC). The portal verifies the Bearer JWT from the `Authorization` header. Cookie-session login is a known follow-up; today the UI pages read the same header via `tenantContextFromRequest`. |
| Machines (API) | **X-API-Key + scopes** — salted key hashes in `ApiKey`, validated by `requireScope`. |

The session registry (`Session` model) records each authenticated access by the **sha256 hash of the token** (never the raw token). Revoking a session marks it `revokedAt`; the next request with that token is rejected at the auth layer.

## APP_MODE — the compliance-gate switch

`APP_MODE = dev | test | prod` (one deployment config, never a user toggle):

| Mode | Compliance gates (verify-before-scan, attest-before-final-report) | RLS |
|---|---|---|
| `dev` | OFF (true scratch) | OFF per the spec table, but our test DB keeps RLS **ON** |
| `test` | OFF | ON |
| `prod` | ON | ON |

Practically: role gates in `can()` are relaxed outside `prod` (that's why route tests stub `APP_MODE=prod`), but **RLS is always enforced** in our test database — the tenant-isolation tests prove it (SQLSTATE `42501`).

## Security invariants (never break these)

1. **Tenant isolation is DB-enforced.** RLS + `asv_app` only. App-level checks are defense-in-depth, not the boundary.
2. **`organizationId` is derived from identity, never input.**
3. **Tenant history is never hard-deleted** — assets are *retired*, sessions and API keys are *revoked*, audit events are append-only. Migrations grant `asv_app` no DELETE on tenant tables.
4. **Secrets and tokens are stored hashed** — API keys (salted), session tokens (sha256), invitation tokens (hash). Raw values appear once at creation, never in storage or logs.
5. **Scan manifests are signed, minimal, and expiring** — the scanner only ever sees what it needs for the current job.
