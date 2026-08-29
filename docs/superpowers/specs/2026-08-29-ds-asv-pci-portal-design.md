# ds-asv — PCI DSS Compliance Portal Design

**Status:** Approved design (MVP slice)
**Date:** 2026-08-29
**Author:** Collaboration with the owner
**Related source docs:** `kilo-asv/docs/Customer-Onboarding-Asset-Management-Design.md`

---

## 0. Overview

A commercial, multi-tenant PCI DSS compliance portal. Merchants (Level 2-4) log in,
register their public assets, approve a scan scope, run a PCI-aligned ASV vulnerability
scan, and receive a report. QSA/assessor organizations can onboard merchants under them.

This is a **SaaS** product hosted by the owner. The owner is therefore in PCI scope for the
hosting infrastructure. A **testing switch** lets the owner develop and test without the
compliance ceremony while keeping the production path fully enforced.

The project consolidates existing work: the ASV scanner code in `kilo-asv`, the portal shell
and OpenAPI spec in `compliance-engine`, and the multi-tenancy design doc in
`kilo-asv/docs/Customer-Onboarding-Asset-Management-Design.md`. The `t2/`, `t3/`, `SIEM/`,
`Scheduled/`, and `claude/` directories are reference-only and are not migrated.

---

## 1. Scope

### 1.1 In the MVP

| Module | In MVP? |
|--------|---------|
| 1. ASV Scanner | ✅ Core |
| 4. Customer Management Center | ✅ Core (this is the portal itself) |
| 5. Self-hosted CVE DB (NVD mirror) | ✅ Core (scanner needs it) |
| 2. Wazuh SIEM | ⏭️ Next phase |
| 3. Threat Detection & Reporting | ⏭️ Next phase |

### 1.2 Deliberately deferred from MVP

Per the onboarding design doc's MVP boundary and the solo/3-month constraint, the MVP
**does not** include:

- Authenticated / credentialed scans (SSH, WinRM, Vault-backed credential profiles)
- Cloud connectors / CMDB sync / advanced asset discovery
- Billing / seats / plans
- Wazuh SIEM integration
- Threat detection / correlation engine
- Report digital signing / attestation (unsigned SAR for MVP)

### 1.3 ASV certification

The MVP ships a PCI-aligned scanner and report format. **Full PCI SSC ASV certification**
(program registration, lab validation against the ASV dataset, re-certification pipeline,
report signing/attestation) is out of scope for the MVP and requires separate program and
legal validation before production.

---

## 2. Architecture

**Control-plane / executor split.** Two services, one shared PostgreSQL.

```
┌─────────────────────────── Control Plane (portal/) ──────────────────────────┐
│  Next.js App Router                       PostgreSQL (RLS)                  │
│  ├─ Clerk auth (session) + API key + scopes   organization_id everywhere    │
│  ├─ Organization / membership / QSA-reseller  + row-level security           │
│  ├─ Asset inventory + verification                                            │
│  ├─ Scope version builder + attestation                                       │
│  ├─ Customer Management Center (UI)                                           │
│  ├─ Findings, Reports, API Keys, Audit                                        │
│  └─ BFF proxy → issues signed scan-job manifests ─────┐                       │
└────────────────────────────────────────────────────────│─────────────────────┘
                                          signed, expiring job manifest
┌─────────────────────────── Scanner Service (scanner/) ───▼─────────────────┐
│  Python/FastAPI + Celery workers             Vault · MinIO · nmap          │
│  ├─ blackbox connector (nmap + testssl)                                    │
│  ├─ CVSS/PCI scoring engine ───▶ self-hosted NVD/CVE DB                    │
│  ├─ Evidence storage ───▶ SAR PDF (unsigned for MVP)                       │
│  └─ writes findings/evidence back to shared Postgres                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Control plane** owns auth, orgs, memberships, assets, scope versions, API keys, customer
management, and the reporting UI. It issues **signed, minimal, expiring scan-job manifests**.

**Scanner service** consumes the manifest, runs the black-box scan, scores findings against
the CVE DB, stores evidence, and writes results back to the shared Postgres. The control
plane surfaces results.

This follows the onboarding design doc's directive: *"Separate control plane from scan
workers. Workers receive a signed, minimal, expiring job manifest."*

---

## 3. Data model & multi-tenancy

Adopted directly from `Customer-Onboarding-Asset-Management-Design.md`. Four distinct
entities:

```
Organization  ──1:N──  Asset  ──1:N──  Scope_Version  ──1:N──  Scan_Target
   (tenant)              (durable)        (immutable)          (per-scan snapshot)
      │
      ├─ memberships + roles (user ↔ org)
      └─ parent_org_id ← QSA reseller nests merchants
```

**Rules:**

- Every tenant table carries `organization_id`. PostgreSQL **row-level security (RLS)**
  enforces tenant isolation server-side.
- `organization_id` is **derived from authenticated identity**, never from the URL or a
  client-supplied id.
- **QSA reseller model:** an organization may have a `parent_org_id`. A QSA org is the
  parent; its merchants are child orgs. Nested orgs, one isolation boundary.
- **Assets are durable; scope versions are immutable snapshots.**

**Tenant roles:** `organization_owner`, `security_admin`, `asset_manager`, `scan_operator`,
`report_viewer`, `billing_admin`. Staff roles are separate (support, analyst, ASV reviewer).

The full domain model table (organizations, membership, contacts, assets, asset_addresses,
asset_verifications, asset_observations, scope_sets, scope_versions, scope_items,
authorizations, scan_jobs, scan_targets, credential_profiles, findings, audit_events) is
adopted as specified in `Customer-Onboarding-Asset-Management-Design.md` §6, with the MVP
subset below.

---

## 4. MVP data model (subset)

Concrete tables created for the MVP (extends `compliance-engine/prisma/schema.prisma`, which
already has `Organization`, `User`, `ApiKey`, `Scan`, `SiemAlert`, `Compliance`; adds the
asset/scope layer):

- `Organization` — tenant boundary + `parentOrgId` (QSA nesting)
- `User` / `OrganizationMembership` — identity + role (membership model from day one)
- `Asset` — durable inventory object (type, canonical_identifier, owner, environment,
  criticality, lifecycle_state, verification_state, source, last_seen_at)
- `AssetVerification` — control/authority evidence
- `ScopeSet` / `ScopeVersion` / `ScopeItem` — immutable, approved scope
- `Authorization` — signed customer authority (statement hash, scope-version hash)
- `Scan` / `ScanTarget` — execution request + immutable execution snapshot
- `Finding` — vulnerability record (fingerprint, severity, status, evidence refs)
- `AuditEvent` — append-only security/workflow history
- `ApiKey` — existing, scoped machine keys
- `Cve` — self-hosted CVE/NVD record (CVSS, affected CPE)

Every table writing user/tenant data carries `organization_id`; RLS enforced.

---

## 5. ASV scan flow (end-to-end)

```
1. Merchant logs in (Clerk)                      [control plane]
2. Adds an asset (IP / CIDR / FQDN)
3. Verifies ownership (DNS TXT / HTTP challenge) [control plane]
4. Approves scope version (attestation)          [control plane]
          └─ issues signed, expiring scan-job manifest
5. Scanner runs black-box scan (nmap + testssl)  [scanner service]
6. Findings scored (CVSS + PCI rules) against CVE DB
7. Evidence stored (MinIO/S3)
8. Merchant sees findings + PCI-aligned report
```

- **Black-box only** in MVP (`auth_method: none`, `nmap -sC -A -Pn`-equivalent profile,
  180s tool timeout). Signed/authenticated scanning (Vault SSH, WinRM) is deferred.
- **Scope-approval gate is the whole point.** No scan runs until a merchant has approved a
  scope version — this is what distinguishes it from a plain port scanner and provides
  defensible compliance evidence.
- Targets are scope-boundary validated; CIDRs are boundaries only and are never passed as
  a single individual-IP profile.

---

## 6. Testing switch

One deployment config setting — **not** a runtime/user toggle.

```
APP_MODE = dev | test | prod
```

| Mode | Compliance gates (scope approval, ownership verify, attestation) | Multi-tenant RLS |
|------|------|------|
| `dev` | OFF | OFF (true scratch) |
| `test` | OFF | ON |
| `prod` | ON | ON |

Wiring:

- A single `compliance-gate` layer (function/decorator) consults `APP_MODE` before each
  gate. `dev`/`test` skip straight through; `prod` enforces everything.
- **UI banner** whenever not in `prod`, so a test run is never mistaken for a real one.
- **Prod is locked:** refuse to start (or hard-fail) if gates are disabled in `prod`, so a
  relaxed mode cannot ship by accident.

---

## 7. Technology stack

- **PostgreSQL** (row-level security), single shared DB
- **Next.js 16 + TypeScript** (control plane / portal UI)
- **Python 3.13 + FastAPI** (scanner service)
- **Celery + Redis** (async scan execution)
- **MinIO / S3** (evidence storage)
- **Clerk** (session auth for UI) + **X-API-Key + scopes** (machine auth)
- **NVD mirror** (self-hosted CVE DB)

---

## 8. Reuse / refactor / throw away

| Source | Reuse | Refactor | Throw away |
|---|---|---|---|
| kilo-asv models | ✅ | — | — |
| kilo-asv black-box scanner | ✅ | — | — |
| kilo-asv SSH/WinRM/Vault | — | ⏭️ defer | — |
| kilo-asv scoring/PCI rules | — | ✅ fix bug #3 (TLS PASS/FAIL) | — |
| kilo-asv NVD loader | — | ✅ fix bug #4 (feed mismatch) | — |
| kilo-asv API/auth | — | — | ❌ rebuild |
| kilo-asv portal + asv-auth | — | — | ❌ throw away (keep JWT/pbkdf2 primitives) |
| compliance-engine OpenAPI spec | ✅ | — | — |
| compliance-engine Prisma schema | ✅ | — | — |
| compliance-engine api-key mgmt | ✅ | — | — |
| compliance-engine mock dashboards | — | — | ❌ throw away |
| onboarding design doc | ✅ | — | — |

**Code bugs fixed during consolidation:**
- #3 — scoring engine: TLS/cipher hard-fail not reflected in final PASS/FAIL (produces wrong
  PCI result)
- #4 — NVD feed loader matches 1.1 feed to a 2.0 parser (empty cache, demo-only CVEs)
- #5 — quarterly-rescan dispatch always uses SSH regardless of `auth_method`
- #6 — `POST /v1/customers` accepts unscoped/`0.0.0.0/0` `scope_ips` (scan-authz bypass)

---

## 9. Repo layout

```
ds-asv/
├── portal/           # Next.js + TS (control plane) — from compliance-engine
│   ├── src/app/     # routes (dashboard, assets, scope, scans, findings, reports)
│   ├── src/server/  # scanner client; siem/waf clients (filled in later)
│   ├── prisma/      # schema (existing 6 models + org/asset/scope/target layer)
│   └── spec/        # openapi.yaml (reused)
├── scanner/         # Python/FastAPI + Celery — from kilo-asv
│   ├── app/         # API, connectors, scoring, reports, tasks, models
│   ├── nvd/         # self-hosted CVE/NVD mirror
│   └── infra/       # terraform, docker, vault policies
├── docs/superpowers/specs/   # design docs (this file)
└── docker-compose.yml        # portal + scanner + postgres + redis + minio
```

Version-control: **new git repo initialized at `ds-asv`**. Old directories remain
untouched as references.

---

## 10. Build order (phased)

Adopted from `Customer-Onboarding-Asset-Management-Design.md` §11, scoped to the MVP:

1. **Phase 1 — Tenant & identity foundation:** orgs, memberships, invites, contacts, RBAC,
   MFA/step-up, append-only audit. *Exit: tenants cannot read/mutate another tenant's objects.*
2. **Phase 2 — Asset inventory:** canonical assets, normalization, CSV import, dedupe,
   lifecycle, verification. *Exit: idempotent imports, invalid rows downloadable, dedupe works.*
3. **Phase 3 — Versioned scope & authorization:** drafts, versions, diffs, validation,
   attestation, immutable hashes. *Exit: no scan without an approved version.*
4. **Phase 4 — Connect scan execution:** generate `scan_targets` from approved scope, sign
   manifest, dispatch workers, reconcile results. *Exit: every finding/report traces asset →
   scope → authorization → scan target.*
5. **Phase 0 — Policy/threat model** precedes coding (auth text, retention, support-access,
   tenant-conflict, emergency-stop policies; threat-model tenant isolation, scope tampering,
   SSRF, abusive scanning, credential theft, report leakage, worker compromise).
