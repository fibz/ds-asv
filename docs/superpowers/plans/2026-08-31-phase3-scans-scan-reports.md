# Phase 3: Scans & Scan Reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the scan workflow end-to-end on the control plane: create a scan from a selected asset list (lightweight scope snapshot), issue a signed expiring manifest for the scanner, ingest findings, generate the Qualys-style PCI report, and enforce the QA attestation gate — so a scan can run (with a simulated scanner in dev/test), produce findings, and yield a report that is not final until QA-attested.

**Architecture:** The control plane (Next.js + PostgreSQL RLS) owns scan orchestration: `Scan`/`ScanTarget` (immutable per-scan snapshot of selected assets), `Finding` (fingerprint-deduped), `Report` + `ReportAttestation`. It issues an HMAC-signed, expiring scan-job manifest (design §2/§5) that the scanner service consumes; findings are written back through an authenticated ingestion endpoint. The Python/FastAPI scanner service (`scanner/`, already consolidated from kilo-asv) is wired in the FOLLOW-UP plan (Phase 3b); this plan defines and tests the manifest + ingestion contract against a **simulated scanner** (dev/test test double), per the design's control-plane/executor split. APP_MODE gates (§6): `prod` requires verified assets before scanning and QA attestation before a report is final; `dev`/`test` relax gates but RLS stays on.

**Tech Stack:** Next.js 16 + TypeScript, Prisma 7 + PostgreSQL (RLS), HMAC-SHA256 (node:crypto) for manifests, Tailwind v4, vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-ds-asv-pci-portal-design.md` (§2 control-plane/executor split, §3 tenancy, §4 models, §5 scan flow, §5.1 report structure, §6 testing switch, §10 build order Phase 4-5 reordered by user directive 2026-08-31: scans + scan reports FIRST, versioned-scope/attestation deferred).

## Global Constraints

- PostgreSQL RLS enforces `organizationId` isolation on every tenant table; `organizationId` derived from authenticated identity (`tenantContextFromRequest`), never client input.
- **Every migration adding a tenant table must ENABLE RLS + create policies + GRANT `asv_app` in the SAME migration** (fail-closed pattern).
- App connects as `asv_app`; admin/test setup uses `pg.Client` from `ADMIN_DATABASE_URL` with **scoped wipes by fixed ids only — never global DELETEs** (parallel vitest workers share one DB).
- `set_config('app.tenant_id', ...)` is transaction-scoped — bind RLS inside `prisma.$transaction` with the tx client (`withTenant` helper).
- **Prisma 7 workflow:** never `migrate dev`. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` (Prisma 7.10 removed `--from-url`) → migration dir → append RLS/grants → `migrate deploy` → `prisma generate`. After any diff verify `Asset_active_unique` survived.
- **APP_MODE gate (§6):** `prod` enforces compliance gates (verified-asset requirement, attestation-before-final-report); `dev`/`test` relax them. RLS is always ON. Prod is locked (refuse relaxed mode).
- **Manifest:** HMAC-SHA256 signed JSON payload `{ scanId, organizationId, targets: [{type, canonicalIdentifier}], issuedAt, expiresAt, nonce }`, expiry 15 minutes, secret from `MANIFEST_SECRET` env (dev fallback `"dev-manifest-secret"`), signed over a canonical JSON string. Never log a full manifest. `verifyScanManifest` rejects expired/tampered/unknown-scanId manifests.
- **Scope:** a scan's targets are an immutable snapshot (`ScanTarget` rows) of the SELECTED assets at creation time — CIDRs are boundaries only, never expanded into individual-IP profiles (design §5). Creating a scan requires assets to be same-org and not retired; in `prod` also requires `verificationState = "verified"` (§6 gate).
- **Findings:** deduped by fingerprint `(scanId, assetId, qid)`; `qid` may be null only when `cveId` is present (fingerprint falls back to `(scanId, assetId, cveId)`).
- **Reports:** structure per §5.1 — attestation section, component compliance summary (per-host PASSED/FAILED), vulnerability summary (totals, average risk, severity 1-5 + PCI High/Medium/Low), detailed per-host/per-finding results, option profile, legend. Aggregation logic mirrors the reused t3 `report-summary` approach (risk rating + severity counts). Report status flow: `DRAFT → SUBMITTED → ATTESTED`; in `prod` a report is not final (200 responses treat ATTESTED as final; DRAFT/SUBMITTED are non-final) until QA-attested.
- **Audit:** every state change writes `recordAudit` (`scan.created`, `scan.status.updated`, `finding.ingested`, `report.generated`, `report.submitted`, `report.attested`).
- **Test command:** `npx --cache /home/cchock/projects/.npm-cache vitest run` in `portal/`. Route tests stub `APP_MODE=prod` for gate assertions and `vi.stubEnv` KEYCLOAK vars per the established pattern.
- **Contract-first:** `portal/spec/openapi.yaml` is the source of truth; the legacy mock-era `/scans` paths are REPLACED by the Phase 3 contract; Task 9 enforces spec ↔ route conformance.
- Roles: `organization_owner`, `security_admin`, `asset_manager`, `scan_operator`, `report_viewer`, `billing_admin`. Gate actions (add in Task 3): `scan.run` (already in rbac.ts), `scan.view`, `report.view` (already), `report.attest` (staff/ASV reviewer; in dev/test relaxed).
- **Scanner integration (the actual Python service) is Phase 3b** — this plan's manifest + ingestion contract is what 3b implements; a `simulatedScanner` test double (Task 4) stands in for dev/test and the TDD loop.

---

## File Structure

```
portal/src/lib/scan/
├── service.ts               # NEW: createScanFromAssets, listScans, getScan, transitionScanStatus
├── service.test.ts          # NEW (real DB)
├── manifest.ts              # NEW: issueScanManifest, verifyScanManifest, canonicalManifest
├── manifest.test.ts         # NEW
├── findings.ts              # NEW: ingestFindings, listFindings
├── findings.test.ts         # NEW (real DB)
├── report.ts                # NEW: buildReport, getReport, submitReport, attestReport
├── report.test.ts           # NEW (real DB)
└── exit.test.ts             # NEW: Phase 3 exit criteria
portal/prisma/schema.prisma  # MODIFY: Scan rework + ScanTarget/Finding/Report/ReportAttestation
portal/prisma/migrations/<ts>_phase3_scan_domain/migration.sql  # NEW (+RLS+GRANTs)
portal/spec/openapi.yaml     # MODIFY: Phase 3 contract (Task 1)
portal/src/app/api/v1/scans/route.ts            # NEW: POST create / GET list
portal/src/app/api/v1/scans/[scanId]/route.ts   # NEW: GET detail / PATCH status
portal/src/app/api/v1/scans/[scanId]/findings/route.ts  # NEW: POST ingest / GET list
portal/src/app/api/v1/reports/[reportId]/route.ts        # NEW: GET report
portal/src/app/api/v1/reports/[reportId]/attest/route.ts # NEW: POST attest
```

---

## Task 1: Phase 3 API contract (replace the legacy /scans mock)

**Files:**
- Modify: `portal/spec/openapi.yaml`
- Test: `portal/src/lib/openapi/contract.test.ts`

**Interfaces:**
- Consumes: the existing `components` block (securitySchemes bearerAuth/ApiKeyAuth, Error schema).
- Produces: the Phase 3 contract — `POST/GET /api/v1/scans`, `GET/PATCH /api/v1/scans/{scanId}`, `GET/POST /api/v1/scans/{scanId}/findings`, `GET /api/v1/reports/{reportId}`, `POST /api/v1/reports/{reportId}/attest`; schemas `Scan`, `ScanTarget`, `Finding`, `Report`, `ReportAttestation`, `ScanCreate`, `Manifest`. The legacy mock paths `/scans`, `/scans/{scanId}` (delete/stopScan) are REPLACED — the old `ScanRequest`/`Scan` schemas are replaced by the new ones.

- [ ] **Step 1: Write the failing contract test (append to `portal/src/lib/openapi/contract.test.ts`)**

```ts
describe("phase 3 scan contract", () => {
  const spec = loadSpec();
  const paths = spec.paths ?? {};

  it("documents scan lifecycle", () => {
    expect(paths["/scans"].post).toBeDefined();
    expect(paths["/scans"].get).toBeDefined();
    expect(paths["/scans/{scanId}"].get).toBeDefined();
    expect(paths["/scans/{scanId}"].patch).toBeDefined();
  });

  it("documents findings ingestion and reports", () => {
    expect(paths["/scans/{scanId}/findings"].post).toBeDefined();
    expect(paths["/scans/{scanId}/findings"].get).toBeDefined();
    expect(paths["/reports/{reportId}"].get).toBeDefined();
    expect(paths["/reports/{reportId}/attest"].post).toBeDefined();
  });

  it("no longer documents the legacy stopScan delete", () => {
    expect(paths["/scans/{scanId}"].delete).toBeUndefined();
  });

  it("defines scan-domain schemas", () => {
    const schemas = spec.components?.schemas ?? {};
    for (const name of ["Scan", "ScanTarget", "Finding", "Report", "ReportAttestation", "ScanCreate"]) {
      expect(schemas[name], `missing schema ${name}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/openapi/contract.test.ts`
Expected: FAIL — `/scans/{scanId}` patch undefined (legacy contract), `/findings` missing.

- [ ] **Step 3: Rewrite the contract in `portal/spec/openapi.yaml`**

Replace the legacy `/scans` and `/scans/{scanId}` path blocks (currently under `tags: [Scanners]`, ApiKeyAuth-scoped, with `delete` stopScan) with:

```yaml
  /scans:
    post:
      operationId: createScan
      summary: Create a scan from a selected asset list (owner/security_admin/scan_operator)
      tags: [user-center, scans]
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/ScanCreate' }
      responses:
        '201':
          description: Scan created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Scan' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '401': { $ref: '#/components/responses/Unauthorized' }
    get:
      operationId: listScans
      summary: List scans for the organization (scan.view)
      tags: [user-center, scans]
      security: [{ bearerAuth: [] }]
      responses:
        '200':
          description: Scans
          content:
            application/json:
              schema:
                type: object
                properties:
                  scans:
                    type: array
                    items: { $ref: '#/components/schemas/Scan' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /scans/{scanId}:
    get:
      operationId: getScan
      summary: Get scan detail with targets (scan.view)
      tags: [user-center, scans]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: scanId, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: Scan detail
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Scan' }
        '404': { $ref: '#/components/responses/NotFound' }
        '403': { $ref: '#/components/responses/Forbidden' }
    patch:
      operationId: updateScanStatus
      summary: Transition scan status (scan.run; findings ingestion also uses this)
      tags: [user-center, scans]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: scanId, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [status]
              properties:
                status: { type: string, enum: [RUNNING, COMPLETED, FAILED] }
      responses:
        '200':
          description: Updated scan
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Scan' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '404': { $ref: '#/components/responses/NotFound' }
  /scans/{scanId}/findings:
    post:
      operationId: ingestFindings
      summary: Write scanner findings back for a scan (manifest-authenticated or scan.run)
      tags: [user-center, scans]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: scanId, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [findings]
              properties:
                findings:
                  type: array
                  items: { $ref: '#/components/schemas/FindingIngest' }
      responses:
        '201':
          description: Findings ingested
          content:
            application/json:
              schema:
                type: object
                properties:
                  count: { type: integer }
        '400': { $ref: '#/components/responses/BadRequest' }
        '404': { $ref: '#/components/responses/NotFound' }
    get:
      operationId: listFindings
      summary: List findings for a scan (scan.view)
      tags: [user-center, scans]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: scanId, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: Findings
          content:
            application/json:
              schema:
                type: object
                properties:
                  findings:
                    type: array
                    items: { $ref: '#/components/schemas/Finding' }
  /reports/{reportId}:
    get:
      operationId: getReport
      summary: Get a generated report (report.view)
      tags: [user-center, scans]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: reportId, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: Report
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Report' }
        '404': { $ref: '#/components/responses/NotFound' }
  /reports/{reportId}/attest:
    post:
      operationId: attestReport
      summary: QA attestation gate — report becomes final only when attested (prod)
      tags: [user-center, scans]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: reportId, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [status]
              properties:
                status: { type: string, enum: [submitted, attested] }
                reason: { type: string }
      responses:
        '200':
          description: Report attestation updated
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Report' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '404': { $ref: '#/components/responses/NotFound' }
```

Add the schemas to `components.schemas` (merge into the existing block):

```yaml
      ScanCreate:
        type: object
        required: [assetIds, name]
        properties:
          assetIds:
            type: array
            minItems: 1
            items: { type: string }
          name: { type: string, minLength: 1, maxLength: 200 }
      ScanTarget:
        type: object
        required: [id, assetId, type, canonicalIdentifier]
        properties:
          id: { type: string }
          assetId: { type: string }
          type: { type: string, enum: [ipv4, ipv6, cidr, fqdn] }
          canonicalIdentifier: { type: string }
          status: { type: string, enum: [pending, clean, failed] }
      Scan:
        type: object
        required: [id, name, status, createdAt]
        properties:
          id: { type: string }
          name: { type: string }
          status: { type: string, enum: [PENDING, RUNNING, COMPLETED, FAILED] }
          manifestIssuedAt: { type: [string, 'null'], format: date-time }
          manifestExpiresAt: { type: [string, 'null'], format: date-time }
          startedAt: { type: string, format: date-time }
          completedAt: { type: [string, 'null'], format: date-time }
          targets:
            type: array
            items: { $ref: '#/components/schemas/ScanTarget' }
      FindingIngest:
        type: object
        required: [assetId, qid, severity, title]
        properties:
          assetId: { type: string }
          qid: { type: string }
          cveId: { type: [string, 'null'] }
          severity: { type: string, enum: [1, 2, 3, 4, 5] }
          pciSeverity: { type: string, enum: [High, Medium, Low] }
          title: { type: string }
          description: { type: string }
          threat: { type: string }
          impact: { type: string }
          result: { type: string }
      Finding:
        allOf:
          - $ref: '#/components/schemas/FindingIngest'
          - type: object
            required: [id, scanId, status, createdAt]
            properties:
              id: { type: string }
              scanId: { type: string }
              status: { type: string, enum: [open, mitigated, accepted] }
              createdAt: { type: string, format: date-time }
      ReportAttestation:
        type: object
        required: [status, reviewedBy, reviewedAt]
        properties:
          status: { type: string, enum: [draft, submitted, attested] }
          reviewedBy: { type: string }
          reviewedAt: { type: string, format: date-time }
          reason: { type: [string, 'null'] }
      Report:
        type: object
        required: [id, scanId, status, summary, createdAt]
        properties:
          id: { type: string }
          scanId: { type: string }
          status: { type: string, enum: [draft, submitted, attested] }
          summary:
            type: object
            properties:
              hosts: { type: integer }
              vulnerabilities: { type: integer }
              averageRisk: { type: number }
              bySeverity:
                type: object
                additionalProperties: { type: integer }
              byPciSeverity:
                type: object
                additionalProperties: { type: integer }
              compliance: { type: string, enum: [PASSED, FAILED] }
          attestation: { $ref: '#/components/schemas/ReportAttestation' }
          createdAt: { type: string, format: date-time }
```

Keep the plan's `Manifest` schema out of the public contract (it is scanner-to-portal, not client-to-portal); the manifest shape lives in Task 4's code + tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/openapi/contract.test.ts`
Expected: PASS (4 new tests).

- [ ] **Step 5: Commit**

```bash
git add portal/spec/openapi.yaml portal/src/lib/openapi/contract.test.ts
git commit -m "docs(portal): Phase 3 scan contract — scans/findings/reports/attestation replace legacy mock"
```

---

## Task 2: Scan-domain models + RLS migration

**Files:**
- Modify: `portal/prisma/schema.prisma`
- Create: `portal/prisma/migrations/20260831000003_phase3_scan_domain/migration.sql`
- Test: `portal/src/lib/scan/scan-rls.test.ts`

**Interfaces:**
- Consumes: `Organization`, `Asset` models.
- Produces: `Scan` (reworked: `organizationId` replaces legacy `orgId`, adds `name`, `manifestIssuedAt`, `manifestExpiresAt`, `requestedById`, removes `target`/`results`), `ScanTarget` (id, scanId, assetId, organizationId, type, canonicalIdentifier, status, createdAt), `Finding` (id, scanId, assetId, organizationId, qid, cveId?, severity, pciSeverity?, title, description?, threat?, impact?, result?, status, createdAt; `@@unique([scanId, assetId, qid])`), `Report` (id, scanId, organizationId, status, summary Json, attestationId?, createdAt; `@@unique([scanId])`), `ReportAttestation` (id, reportId, status, reviewedById, reason?, reviewedAt, createdAt). All tenant tables RLS + GRANT asv_app in the same migration.

- [ ] **Step 1: Write the failing RLS test**

Create `portal/src/lib/scan/scan-rls.test.ts` (real DB harness — fixed ids, scoped admin wipe, `withTenant`):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_scan_rls_0001";
const USER = "user_scan_rls_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const t of ["Finding", "ScanTarget", "Scan", "ReportAttestation", "Report"]) {
      await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [ORG]);
    }
    await admin.query(`DELETE FROM "AuditEvent" WHERE "organizationId" = $1`, [ORG]);
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("scan domain RLS", () => {
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, async (tx) => {
      await tx.organization.create({ data: { id: ORG, name: "Scan RLS Org" } });
      await tx.user.create({ data: { id: USER, idpId: "kc-scan-rls", email: "s@x.com" } });
    });
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("asv_app cannot insert a Scan without tenant context (42501)", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Scan" ("id","organizationId","name","status") VALUES ($1,$2,$3,'PENDING')`,
        "scan_rls_x", ORG, "x"
      )
    ).rejects.toThrow(/42501/);
  });

  it("asv_app inserts all five tables inside tenant context", async () => {
    await withTenant(ORG, async (tx) => {
      const scan = await tx.scan.create({ data: { id: "scan_rls_1", organizationId: ORG, name: "RLS scan", requestedById: USER } });
      await tx.scanTarget.create({ data: { id: "st_rls_1", scanId: scan.id, assetId: "asset_rls_1", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.0.0.1" } });
      await tx.finding.create({ data: { id: "f_rls_1", scanId: scan.id, assetId: "asset_rls_1", organizationId: ORG, qid: "q1", severity: "4", title: "TLS weak" } });
      const report = await tx.report.create({ data: { id: "r_rls_1", scanId: scan.id, organizationId: ORG, status: "draft", summary: { hosts: 1 } } });
      await tx.reportAttestation.create({ data: { id: "ra_rls_1", reportId: report.id, organizationId: ORG, status: "draft", reviewedById: USER } });
    });
    const found = await withTenant(ORG, (tx) => tx.scan.findUnique({ where: { id: "scan_rls_1" } }));
    expect(found?.organizationId).toBe(ORG);
  });

  it("scan tables grants exclude DELETE for asv_app", async () => {
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "Scan" WHERE id = 'scan_rls_1'`)).rejects.toThrow(/permission denied/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/scan-rls.test.ts`
Expected: FAIL — `prisma.scanTarget` undefined / model mismatch (legacy Scan lacks fields).

- [ ] **Step 3: Rework the models in `schema.prisma`**

Replace the legacy `Scan` model with:

```prisma
model Scan {
  id                String        @id @default(cuid())
  organizationId    String
  name              String
  status            String        @default("PENDING") // PENDING, RUNNING, COMPLETED, FAILED
  requestedById     String
  manifestIssuedAt  DateTime?
  manifestExpiresAt DateTime?
  startedAt         DateTime      @default(now())
  completedAt       DateTime?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  organization      Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  targets           ScanTarget[]
  findings          Finding[]
  report            Report?

  @@index([organizationId])
  @@index([organizationId, status])
}

model ScanTarget {
  id                 String   @id @default(cuid())
  scanId             String
  assetId            String
  organizationId     String
  type               String   // ipv4 | ipv6 | cidr | fqdn
  canonicalIdentifier String
  status             String   @default("pending") // pending, clean, failed
  createdAt          DateTime @default(now())
  scan               Scan     @relation(fields: [scanId], references: [id], onDelete: Cascade)
  organization       Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([scanId])
  @@index([organizationId])
}

model Finding {
  id             String   @id @default(cuid())
  scanId         String
  assetId        String
  organizationId String
  qid            String
  cveId          String?
  severity       String   // 1-5
  pciSeverity    String?  // High | Medium | Low
  title          String
  description    String?
  threat         String?
  impact         String?
  result         String?
  status         String   @default("open") // open, mitigated, accepted
  createdAt      DateTime @default(now())
  scan           Scan     @relation(fields: [scanId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([scanId, assetId, qid])
  @@index([organizationId])
  @@index([scanId, status])
}

model Report {
  id             String            @id @default(cuid())
  scanId         String
  organizationId String
  status         String            @default("draft") // draft, submitted, attested
  summary        Json
  attestationId  String?           @unique
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
  scan           Scan              @relation(fields: [scanId], references: [id], onDelete: Cascade)
  organization   Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  attestation    ReportAttestation? @relation("ReportAttestation", fields: [attestationId], references: [id])

  @@unique([scanId])
  @@index([organizationId])
}

model ReportAttestation {
  id             String   @id @default(cuid())
  reportId       String
  organizationId String
  status         String   @default("draft") // draft, submitted, attested
  reviewedById   String
  reason         String?
  reviewedAt     DateTime @default(now())
  createdAt      DateTime @default(now())
  report         Report   @relation("ReportAttestation", fields: [reportId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([reportId])
  @@index([organizationId])
}
```

Add `scans Scan[]`, `targets ScanTarget[]`, `findings Finding[]`, `reports Report[]` to `Organization`; `scans Scan[]` to `User` (as requestedBy). The legacy `Scan.orgId` relation is removed (migration renames the column).

- [ ] **Step 4: Generate migration + append RLS/grants**

```bash
cd portal
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > /tmp/phase3_migration.sql
mkdir -p prisma/migrations/20260831000003_phase3_scan_domain
cp /tmp/phase3_migration.sql prisma/migrations/20260831000003_phase3_scan_domain/migration.sql
```

Verify the diff renames `Scan.orgId` → `Scan.organizationId` (or recreates the table) and creates ScanTarget/Finding/Report/ReportAttestation with the FKs/indexes. Verify `Asset_active_unique` survived; re-append if dropped. Then append:

```sql
-- Phase 3: scan-domain RLS (fail-closed pattern).
ALTER TABLE "Scan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scan_tenant_isolation ON "Scan"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "ScanTarget" ENABLE ROW LEVEL SECURITY;
CREATE POLICY scan_target_tenant_isolation ON "ScanTarget"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "Finding" ENABLE ROW LEVEL SECURITY;
CREATE POLICY finding_tenant_isolation ON "Finding"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "Report" ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_tenant_isolation ON "Report"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

ALTER TABLE "ReportAttestation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_attestation_tenant_isolation ON "ReportAttestation"
  USING ("organizationId" = current_setting('app.tenant_id', true))
  WITH CHECK ("organizationId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON "Scan" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "ScanTarget" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "Finding" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "Report" TO asv_app;
GRANT SELECT, INSERT, UPDATE ON "ReportAttestation" TO asv_app;
```

(No DELETE grants — scan records, findings, and reports are history, never deleted.)

```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/scan-rls.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add portal/prisma/schema.prisma portal/prisma/migrations/20260831000003_phase3_scan_domain portal/src/lib/scan
git commit -m "feat(portal): scan-domain models (Scan rework + ScanTarget/Finding/Report/Attestation) + RLS"
```

---

## Task 3: Scan service (create from assets, list, get, status transitions)

**Files:**
- Create: `portal/src/lib/scan/service.ts`
- Test: `portal/src/lib/scan/service.test.ts`

**Interfaces:**
- Consumes: `TenantContext`, `can()` actions `scan.run` (exists) + NEW `scan.view` (add to rbac.ts in this task: `scan.view` → owner/security_admin/asset_manager/scan_operator), `recordAudit`, `Asset` model.
- Produces:
  - `createScanFromAssets(ctx, input: { name: string; assetIds: string[] }): Promise<Scan>` — RLS tx: fetch assets by ids (org-scoped); validate ≥1, none retired, in `prod` all `verificationState === "verified"` (else throw `ScanGuardError`); create Scan + ScanTarget rows (snapshot: type + canonicalIdentifier from each asset); audit `scan.created`.
  - `listScans(ctx): Promise<Scan[]>` — org-scoped, newest first, with targets.
  - `getScan(ctx, scanId): Promise<Scan | null>` — org-scoped with targets + findings count.
  - `transitionScanStatus(ctx, scanId, status: "RUNNING" | "COMPLETED" | "FAILED"): Promise<Scan | null>` — org-scoped; valid transitions PENDING→RUNNING, RUNNING→COMPLETED/FAILED; sets completedAt on terminal; audit `scan.status.updated`.
  - `ScanGuardError` exported.

- [ ] **Step 1: Add the `scan.view` RBAC action**

In `portal/src/lib/auth/rbac.ts` after the `scan.run` line add:
```ts
  if (action === "scan.view") return hasRole(user, "organization_owner", "security_admin", "asset_manager", "scan_operator");
```
Add one assertion to `rbac.test.ts` (scan.view true for scan_operator + asset_manager, false for report_viewer).

- [ ] **Step 2: Write the failing service test**

Create `portal/src/lib/scan/service.test.ts` (real DB harness; fixed ids `org_scan_svc_0001`, `user_scan_svc_0001`; two assets via the assets service or direct `tx.asset.create` with `lifecycleState: "active"`, `verificationState: "verified"`):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets, listScans, getScan, transitionScanStatus, ScanGuardError } from "@/lib/scan/service";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_scan_svc_0001";
const ORG2 = "org_scan_svc_0002";
const USER = "user_scan_svc_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "scan_operator", isStaff: false, appMode: "prod" };
const ctx2: TenantContext = { userId: USER, organizationId: ORG2, role: "scan_operator", isStaff: false, appMode: "prod" };

let assetA = ""; let assetB = "";

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG, ORG2]) {
      for (const t of ["Finding", "ScanTarget", "Scan", "ReportAttestation", "Report", "AuditEvent", "Asset"]) {
        await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [o]);
      }
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("scan service", () => {
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG, ORG2]) await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Scan ${o}` } }));
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-scan-svc", email: "s@x.com" } }));
    await withTenant(ORG, async (tx) => {
      assetA = (await tx.asset.create({ data: { id: "asset_scan_svc_a", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.0.0.5", lifecycleState: "active", verificationState: "verified" } })).id;
      assetB = (await tx.asset.create({ data: { id: "asset_scan_svc_b", organizationId: ORG, type: "fqdn", canonicalIdentifier: "web.example.com", lifecycleState: "active", verificationState: "verified" } })).id;
    });
  });

  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("creates a scan with immutable targets snapshotting the selected assets", async () => {
    const scan = await createScanFromAssets(ctx, { name: "Quarterly ASV", assetIds: [assetA, assetB] });
    expect(scan.status).toBe("PENDING");
    expect(scan.targets.map((t) => t.canonicalIdentifier).sort()).toEqual(["10.0.0.5", "web.example.com"]);
    expect(scan.targets.every((t) => t.status === "pending")).toBe(true);
  });

  it("rejects empty selections and retired assets", async () => {
    await expect(createScanFromAssets(ctx, { name: "empty", assetIds: [] })).rejects.toThrow(/assetIds/);
    await withTenant(ORG, (tx) => tx.asset.update({ where: { id: assetA }, data: { lifecycleState: "retired" } }));
    await expect(createScanFromAssets(ctx, { name: "retired", assetIds: [assetA] })).rejects.toBeInstanceOf(ScanGuardError);
    await withTenant(ORG, (tx) => tx.asset.update({ where: { id: assetA }, data: { lifecycleState: "active" } }));
  });

  it("is tenant-scoped: other org cannot see or create against our assets", async () => {
    const scan = await createScanFromAssets(ctx, { name: "scoped", assetIds: [assetA] });
    expect(await getScan(ctx2, scan.id)).toBeNull();
    await expect(createScanFromAssets(ctx2, { name: "x", assetIds: [assetA] })).rejects.toBeInstanceOf(ScanGuardError);
  });

  it("transitions status with valid moves only", async () => {
    const scan = await createScanFromAssets(ctx, { name: "status flow", assetIds: [assetB] });
    const running = await transitionScanStatus(ctx, scan.id, "RUNNING");
    expect(running?.status).toBe("RUNNING");
    const done = await transitionScanStatus(ctx, scan.id, "COMPLETED");
    expect(done?.status).toBe("COMPLETED");
    expect(done?.completedAt).not.toBeNull();
    await expect(transitionScanStatus(ctx, scan.id, "RUNNING")).rejects.toThrow(/transition/);
  });

  it("audits scan.created and scan.status.updated", async () => {
    const scan = await createScanFromAssets(ctx, { name: "audited", assetIds: [assetB] });
    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { action: { in: ["scan.created", "scan.status.updated"] }, resourceId: scan.id } }));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/service.test.ts`
Expected: FAIL — module `@/lib/scan/service` not found.

- [ ] **Step 4: Implement the service**

Create `portal/src/lib/scan/service.ts`:
```ts
import { prisma } from "@/lib/prisma-client";
import { setRlsContext, getAppMode } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, Scan } from "@/lib/generated/prisma";

export class ScanGuardError extends Error {}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

const TARGET_TYPES = ["ipv4", "ipv6", "cidr", "fqdn"];
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["RUNNING"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export async function createScanFromAssets(
  ctx: TenantContext,
  input: { name: string; assetIds: string[] }
): Promise<Scan & { targets: { id: string; assetId: string; type: string; canonicalIdentifier: string; status: string }[] }> {
  const name = input.name.trim();
  if (!name || name.length > 200) throw new ScanGuardError("name must be a non-empty string up to 200 chars");
  if (!Array.isArray(input.assetIds) || input.assetIds.length === 0) throw new ScanGuardError("assetIds must contain at least one asset");
  const prod = getAppMode() === "prod";
  return withTenant(ctx.organizationId, async (tx) => {
    const assets = await tx.asset.findMany({ where: { id: { in: input.assetIds }, organizationId: ctx.organizationId } });
    if (assets.length !== new Set(input.assetIds).size) {
      throw new ScanGuardError("one or more assets not found in this organization");
    }
    for (const a of assets) {
      if (a.lifecycleState === "retired") throw new ScanGuardError(`asset ${a.canonicalIdentifier} is retired`);
      if (prod && a.verificationState !== "verified") {
        throw new ScanGuardError(`asset ${a.canonicalIdentifier} is not verified (required in prod)`);
      }
    }
    const scan = await tx.scan.create({ data: { organizationId: ctx.organizationId, name, requestedById: ctx.userId } });
    for (const a of assets) {
      await tx.scanTarget.create({
        data: { scanId: scan.id, assetId: a.id, organizationId: ctx.organizationId, type: a.type, canonicalIdentifier: a.canonicalIdentifier },
      });
    }
    await recordAudit(ctx, "scan.created", "Scan", scan.id, undefined, { name, targets: assets.map((a) => a.canonicalIdentifier) }, undefined, tx);
    const targets = await tx.scanTarget.findMany({ where: { scanId: scan.id } });
    return { ...scan, targets };
  });
}

export async function listScans(ctx: TenantContext): Promise<(Scan & { targets: unknown[] })[]> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.scan.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, include: { targets: true } })
  );
}

export async function getScan(ctx: TenantContext, scanId: string): Promise<(Scan & { targets: unknown[]; _count: { findings: number } }) | null> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.scan.findUnique({ where: { id: scanId }, include: { targets: true, _count: { select: { findings: true } } } })
  );
}

export async function transitionScanStatus(
  ctx: TenantContext,
  scanId: string,
  status: "RUNNING" | "COMPLETED" | "FAILED"
): Promise<Scan | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const scan = await tx.scan.findUnique({ where: { id: scanId } });
    if (!scan) return null;
    if (!(VALID_TRANSITIONS[scan.status] ?? []).includes(status)) {
      throw new ScanGuardError(`invalid transition ${scan.status} -> ${status}`);
    }
    const data: Prisma.ScanUpdateInput = { status };
    if (status === "COMPLETED" || status === "FAILED") data.completedAt = new Date();
    const updated = await tx.scan.update({ where: { id: scanId }, data });
    await recordAudit(ctx, "scan.status.updated", "Scan", scanId, { status: scan.status }, { status }, undefined, tx);
    return updated;
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add portal/src/lib/auth/rbac.ts portal/src/lib/auth/rbac.test.ts portal/src/lib/scan/service.ts portal/src/lib/scan/service.test.ts
git commit -m "feat(portal): scan service — create from selected assets, status transitions, RLS-scoped"
```

---

## Task 4: Scan manifest (issue + verify)

**Files:**
- Create: `portal/src/lib/scan/manifest.ts`
- Test: `portal/src/lib/scan/manifest.test.ts`

**Interfaces:**
- Consumes: `getScan` (Task 3), `getAppMode`, `node:crypto`.
- Produces:
  - `issueScanManifest(ctx, scanId): Promise<{ manifest: string; expiresAt: Date }>` — RLS-scoped getScan; builds payload `{ scanId, organizationId, targets: [{type, canonicalIdentifier}], issuedAt, expiresAt (now+15min), nonce }`; signs HMAC-SHA256 over the canonical JSON; stores `manifestIssuedAt`/`manifestExpiresAt` on the Scan; returns `manifest: "<payload>.<sig>"` (base64url).
  - `verifyScanManifest(token: string): Promise<{ scanId: string; organizationId: string; targets: { type: string; canonicalIdentifier: string }[] } | null>` — splits on ".", recomputes HMAC (timing-safe compare), rejects expired/tampered; returns null on any failure (never throws).
  - `simulatedScanner(manifest: string): Promise<{ assetId: string; findings: ... }[]>` — the dev/test test double: verifies the manifest, maps each target to a canned finding (severity 4 TLS + severity 2 info), returns per-target findings. Used by Task 6 tests + dev.

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/scan/manifest.test.ts` (unit — no DB needed except issuing against a real scan; use the Task 3 service with the same real-DB harness, or a direct scan row):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets } from "@/lib/scan/service";
import { issueScanManifest, verifyScanManifest, simulatedScanner } from "@/lib/scan/manifest";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_manifest_0001";
const USER = "user_manifest_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}
const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "scan_operator", isStaff: false, appMode: "prod" };

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const t of ["Finding", "ScanTarget", "Scan", "AuditEvent", "Asset"]) {
      await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [ORG]);
    }
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("scan manifest", () => {
  let scanId = "";
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, (tx) => tx.organization.create({ data: { id: ORG, name: "Manifest Org" } }));
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-manifest", email: "m@x.com" } }));
    const assetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_manifest_1", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.1.1.1", lifecycleState: "active", verificationState: "verified" } }))).id;
    scanId = (await createScanFromAssets(ctx, { name: "manifest scan", assetIds: [assetId] })).id;
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("issues a signed expiring manifest with the target snapshot", async () => {
    const { manifest, expiresAt } = await issueScanManifest(ctx, scanId);
    expect(manifest).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const verified = await verifyScanManifest(manifest);
    expect(verified?.scanId).toBe(scanId);
    expect(verified?.organizationId).toBe(ORG);
    expect(verified?.targets.map((t) => t.canonicalIdentifier)).toEqual(["10.1.1.1"]);
  });

  it("rejects tampered and expired manifests", async () => {
    const { manifest } = await issueScanManifest(ctx, scanId);
    const [payload, sig] = manifest.split(".");
    const tampered = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), targets: [] })).toString("base64url")}.${sig}`;
    expect(await verifyScanManifest(tampered)).toBeNull();
    const expired = `${payload}.${Buffer.from("f".repeat(64), "hex").toString("base64url")}`;
    expect(await verifyScanManifest(expired)).toBeNull();
    expect(await verifyScanManifest("garbage")).toBeNull();
  });

  it("simulatedScanner returns canned findings per target", async () => {
    const { manifest } = await issueScanManifest(ctx, scanId);
    const result = await simulatedScanner(manifest);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].findings.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/manifest.test.ts`
Expected: FAIL — module `@/lib/scan/manifest` not found.

- [ ] **Step 3: Implement the manifest module**

Create `portal/src/lib/scan/manifest.ts`:
```ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { getScan } from "@/lib/scan/service";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

export const MANIFEST_TTL_MS = 15 * 60 * 1000;

function manifestSecret(): string {
  return process.env.MANIFEST_SECRET || "dev-manifest-secret";
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function canonical(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

function sign(payload: Record<string, unknown>): string {
  return createHmac("sha256", manifestSecret()).update(canonical(payload)).digest("hex");
}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

export async function issueScanManifest(
  ctx: TenantContext,
  scanId: string
): Promise<{ manifest: string; expiresAt: Date }> {
  const scan = await getScan(ctx, scanId);
  if (!scan) throw new Error("Scan not found");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + MANIFEST_TTL_MS);
  const payload = {
    scanId,
    organizationId: ctx.organizationId,
    targets: scan.targets.map((t) => ({ type: t.type, canonicalIdentifier: t.canonicalIdentifier })),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nonce: randomBytes(16).toString("hex"),
  };
  const manifest = `${b64url(JSON.stringify(payload))}.${sign(payload)}`;
  await withTenant(ctx.organizationId, (tx) =>
    tx.scan.update({ where: { id: scanId }, data: { manifestIssuedAt: issuedAt, manifestExpiresAt: expiresAt } })
  );
  return { manifest, expiresAt };
}

export interface VerifiedManifest {
  scanId: string;
  organizationId: string;
  targets: { type: string; canonicalIdentifier: string }[];
}

export async function verifyScanManifest(token: string): Promise<VerifiedManifest | null> {
  try {
    const dot = token.indexOf(".");
    if (dot < 1) return null;
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as Record<string, unknown>;
    const expected = Buffer.from(sign(payload), "hex");
    const actual = Buffer.from(sig, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const expiresAt = new Date(payload.expiresAt as string);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) return null;
    if (typeof payload.scanId !== "string" || typeof payload.organizationId !== "string" || !Array.isArray(payload.targets)) return null;
    return {
      scanId: payload.scanId,
      organizationId: payload.organizationId,
      targets: payload.targets as VerifiedManifest["targets"],
    };
  } catch {
    return null;
  }
}

export interface SimulatedFinding {
  assetId: string;
  qid: string;
  cveId: string | null;
  severity: string;
  pciSeverity: string;
  title: string;
  description: string;
  threat: string;
  impact: string;
  result: string;
}

export async function simulatedScanner(manifest: string): Promise<{ assetId: string; findings: SimulatedFinding[] }[]> {
  const verified = await verifyScanManifest(manifest);
  if (!verified) return [];
  // Test double: one target per scan, canned finding set. Mirrors what the
  // real scanner (Phase 3b) writes back via POST /scans/{id}/findings.
  return verified.targets.map((t, i) => ({
    assetId: t.canonicalIdentifier, // real scanner maps by assetId from the manifest
    findings: [
      {
        assetId: t.canonicalIdentifier,
        qid: `5000${i}`,
        cveId: null,
        severity: "4",
        pciSeverity: "High",
        title: "SSL/TLS uses weak cipher suites",
        description: "The service accepts weak ciphers.",
        threat: "An attacker may decrypt or modify traffic.",
        impact: "Confidentiality and integrity at risk.",
        result: "Verified by TLS handshake analysis.",
      },
      {
        assetId: t.canonicalIdentifier,
        qid: `1000${i}`,
        cveId: "CVE-2021-0000",
        severity: "2",
        pciSeverity: "Low",
        title: "Server banner disclosure",
        description: "The service discloses its version banner.",
        threat: "Assists targeted exploitation.",
        impact: "Low.",
        result: "Banner observed in handshake.",
      },
    ],
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/manifest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/scan/manifest.ts portal/src/lib/scan/manifest.test.ts
git commit -m "feat(portal): scan manifest — HMAC-signed expiring, verify + simulated scanner test double"
```

---

## Task 5: Scan API routes

**Files:**
- Create: `portal/src/app/api/v1/scans/route.ts`, `portal/src/app/api/v1/scans/[scanId]/route.ts`
- Test: `portal/src/app/api/v1/scans/route.test.ts`

**Interfaces:**
- Consumes: `createScanFromAssets`, `listScans`, `getScan`, `transitionScanStatus`, `issueScanManifest` (Task 4 — POST create returns the manifest when a scanner is available; MVP: POST create returns the scan, and `GET /api/v1/scans/{id}/manifest` is NOT exposed — manifest issuance is called by the dispatch path in Task 6; for MVP the route test asserts create+list+get+patch).
- Produces: `POST /api/v1/scans` (gate `scan.run`; 201 scan + targets), `GET /api/v1/scans` (gate `scan.view`), `GET /api/v1/scans/{scanId}` (gate `scan.view`; 404), `PATCH /api/v1/scans/{scanId}` (gate `scan.run`; body `{status}`; 400 invalid transition via `ScanGuardError`, 404 unknown).

- [ ] **Step 1: Write the failing route test**

Create `portal/src/app/api/v1/scans/route.test.ts` (mock pattern from the user-center route tests: `vi.mock("jose")` + txMock incl. `session` + `scan`/`scanTarget`/`asset` + `$transaction(fn)=>fn(txMock)`; `APP_MODE=prod` + KEYCLOAK stubs in beforeEach):
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { POST, GET } from "./route";
import { GET as getOne, PATCH } from "./[scanId]/route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    asset: { findMany: vi.fn() },
    scan: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    scanTarget: { create: vi.fn(), findMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const CLAIMS = { sub: "kc-scan-route", email: "op@x.com" };
const scanRow = (over: Record<string, unknown> = {}) => ({
  id: "scan_1", organizationId: "org_1", name: "Q ASV", status: "PENDING", requestedById: "u1",
  manifestIssuedAt: null, manifestExpiresAt: null, startedAt: new Date(), completedAt: null,
  createdAt: new Date(), updatedAt: new Date(), targets: [], ...over,
});

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method, headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function setup(role: string, scan?: Record<string, unknown> | null) {
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: CLAIMS, protectedHeader: {} } as never);
  vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email, orgId: "org_1", role: "admin" } as never);
  vi.mocked(prisma.organizationMembership.findFirst).mockResolvedValueOnce({ userId: "u1", organizationId: "org_1", role, status: "active" } as never);
  const row = scan === undefined ? scanRow() : scan;
  vi.mocked(prisma.scan.findUnique).mockResolvedValue(row as never);
  vi.mocked(prisma.scan.findMany).mockResolvedValue([row] as never);
  vi.mocked(prisma.scan.create).mockResolvedValue(row as never);
  vi.mocked(prisma.scan.update).mockImplementation(((_, data) => Promise.resolve({ ...(row as object), ...(data as object) })) as never);
  vi.mocked(prisma.scanTarget.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.asset.findMany).mockResolvedValue([{ id: "a1", organizationId: "org_1", type: "ipv4", canonicalIdentifier: "10.0.0.1", lifecycleState: "active", verificationState: "verified" }] as never);
}

describe("scan routes", () => {
  beforeEach(() => { vi.stubEnv("APP_MODE", "prod"); vi.stubEnv("KEYCLOAK_ISSUER", "https://kc.test"); vi.stubEnv("KEYCLOAK_CLIENT_ID", "test"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("POST creates a scan for scan.run roles, 403 for report_viewer", async () => {
    setup("report_viewer");
    expect((await POST(req("/api/v1/scans", "POST", { name: "x", assetIds: ["a1"] }))).status).toBe(403);
    setup("scan_operator");
    const res = await POST(req("/api/v1/scans", "POST", { name: "Q ASV", assetIds: ["a1"] }));
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe("scan_1");
  });

  it("POST 400 for empty assetIds and invalid name", async () => {
    setup("scan_operator");
    expect((await POST(req("/api/v1/scans", "POST", { name: "x", assetIds: [] }))).status).toBe(400);
    setup("scan_operator");
    expect((await POST(req("/api/v1/scans", "POST", { name: "  ", assetIds: ["a1"] }))).status).toBe(400);
  });

  it("GET lists scans for scan.view, 403 for report_viewer", async () => {
    setup("report_viewer");
    expect((await GET(req("/api/v1/scans", "GET"))).status).toBe(403);
    setup("asset_manager");
    const res = await GET(req("/api/v1/scans", "GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).scans).toHaveLength(1);
  });

  it("GET [id] 404 for unknown scan", async () => {
    setup("scan_operator", null);
    expect((await getOne(req("/api/v1/scans/nope", "GET"), { params: Promise.resolve({ scanId: "nope" }) })).status).toBe(404);
  });

  it("PATCH transitions status, 400 on invalid transition", async () => {
    setup("scan_operator");
    const res = await PATCH(req("/api/v1/scans/scan_1", "PATCH", { status: "RUNNING" }), { params: Promise.resolve({ scanId: "scan_1" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("RUNNING");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/app/api/v1/scans/route.test.ts`
Expected: FAIL — module `./route` not found.

- [ ] **Step 3: Implement the routes**

Create `portal/src/app/api/v1/scans/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { createScanFromAssets, listScans } from "@/lib/scan/service";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scan.run")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  const assetIds = Array.isArray(body?.assetIds) ? body.assetIds.filter((x: unknown) => typeof x === "string") : [];
  if (!name.trim() || assetIds.length === 0) {
    return NextResponse.json({ error: "name and at least one assetId are required" }, { status: 400 });
  }
  try {
    const scan = await createScanFromAssets(ctx, { name, assetIds });
    return NextResponse.json(scan, { status: 201 });
  } catch (err) {
    return routeErrorResponse(err);
  }
}

export async function GET(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scan.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scans = await listScans(ctx);
  return NextResponse.json({ scans });
}
```

Create `portal/src/app/api/v1/scans/[scanId]/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { getScan, transitionScanStatus } from "@/lib/scan/service";
import { routeErrorResponse } from "@/lib/http-error";

export async function GET(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scan.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { scanId } = await params;
  const scan = await getScan(ctx, scanId);
  if (!scan) return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  return NextResponse.json(scan);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scan.run")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { scanId } = await params;
  const body = await request.json().catch(() => null);
  const status = typeof body?.status === "string" ? body.status : "";
  if (!["RUNNING", "COMPLETED", "FAILED"].includes(status)) {
    return NextResponse.json({ error: "status must be RUNNING, COMPLETED or FAILED" }, { status: 400 });
  }
  try {
    const scan = await transitionScanStatus(ctx, scanId, status as "RUNNING" | "COMPLETED" | "FAILED");
    if (!scan) return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    return NextResponse.json(scan);
  } catch (err) {
    return routeErrorResponse(err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/app/api/v1/scans/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add portal/src/app/api/v1/scans
git commit -m "feat(portal): scan API routes (create/list/get/status, role-gated)"
```

---

## Task 6: Findings ingestion + dispatch loop

**Files:**
- Create: `portal/src/lib/scan/findings.ts`
- Test: `portal/src/lib/scan/findings.test.ts`
- Create: `portal/src/app/api/v1/scans/[scanId]/findings/route.ts`
- Test: `portal/src/app/api/v1/scans/[scanId]/findings/route.test.ts`

**Interfaces:**
- Consumes: `issueScanManifest`, `verifyScanManifest`, `simulatedScanner` (Task 4), `transitionScanStatus`, `recordAudit`, `Finding` model.
- Produces:
  - `ingestFindings(ctx, scanId, findings: FindingIngest[]): Promise<{ count: number }>` — RLS tx; validates each finding's `assetId` belongs to the scan's targets (same org); upserts by `scanId_assetId_qid` unique (dedupe: re-ingest updates title/severity/status? NO — updates nothing beyond first insert; duplicate = no-op); audit `finding.ingested`.
  - `runScanWithSimulatedScanner(ctx, scanId): Promise<{ findings: number }>` — dev/test dispatch: issue manifest → simulatedScanner → ingestFindings → transition RUNNING→COMPLETED; returns count. Used by tests and the dev UI path.
  - Route `POST /api/v1/scans/{scanId}/findings` — accepts EITHER `Authorization: Bearer <manifest>` (scanner) OR a user ctx with `scan.run`; validates manifest belongs to scanId when present; 400 invalid body / unknown assetId; 404 unknown scan.

- [ ] **Step 1: Write the failing service test**

Create `portal/src/lib/scan/findings.test.ts` (real DB harness like Task 3; seed scan + targets):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets } from "@/lib/scan/service";
import { ingestFindings, runScanWithSimulatedScanner } from "@/lib/scan/findings";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_findings_0001";
const USER = "user_findings_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}
const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "scan_operator", isStaff: false, appMode: "prod" };

let assetId = "";

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const t of ["Finding", "ScanTarget", "Scan", "AuditEvent", "Asset"]) {
      await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [ORG]);
    }
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("findings ingestion", () => {
  let scanId = "";
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, (tx) => tx.organization.create({ data: { id: ORG, name: "Findings Org" } }));
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-findings", email: "f@x.com" } }));
    assetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_findings_1", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.2.2.2", lifecycleState: "active", verificationState: "verified" } }))).id;
    scanId = (await createScanFromAssets(ctx, { name: "findings scan", assetIds: [assetId] })).id;
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("ingests findings deduped by (scanId, assetId, qid)", async () => {
    const f = [{ assetId, qid: "q-a", severity: "4", pciSeverity: "High", title: "Weak TLS", description: "d", threat: "t", impact: "i", result: "r" }];
    const first = await ingestFindings(ctx, scanId, f);
    expect(first.count).toBe(1);
    const again = await ingestFindings(ctx, scanId, f);
    expect(again.count).toBe(0); // duplicate is a no-op
    const rows = await withTenant(ORG, (tx) => tx.finding.findMany({ where: { scanId } }));
    expect(rows).toHaveLength(1);
  });

  it("rejects findings for assets outside the scan's targets", async () => {
    await expect(ingestFindings(ctx, scanId, [{ assetId: "asset_other_1", qid: "q-b", severity: "1", title: "x" }]))
      .rejects.toThrow(/asset/);
  });

  it("runScanWithSimulatedScanner issues a manifest, ingests, and completes the scan", async () => {
    const { findings } = await runScanWithSimulatedScanner(ctx, scanId);
    expect(findings).toBeGreaterThanOrEqual(1);
    const scan = await withTenant(ORG, (tx) => tx.scan.findUnique({ where: { id: scanId } }));
    expect(scan?.status).toBe("COMPLETED");
    expect(scan?.manifestIssuedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/findings.test.ts`
Expected: FAIL — module `@/lib/scan/findings` not found.

- [ ] **Step 3: Implement the service**

Create `portal/src/lib/scan/findings.ts`:
```ts
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { getScan, transitionScanStatus } from "@/lib/scan/service";
import { issueScanManifest, simulatedScanner } from "@/lib/scan/manifest";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

export interface FindingIngest {
  assetId: string;
  qid: string;
  cveId?: string | null;
  severity: string;
  pciSeverity?: string;
  title: string;
  description?: string;
  threat?: string;
  impact?: string;
  result?: string;
}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

export async function ingestFindings(
  ctx: TenantContext,
  scanId: string,
  findings: FindingIngest[]
): Promise<{ count: number }> {
  return withTenant(ctx.organizationId, async (tx) => {
    const scan = await tx.scan.findUnique({ where: { id: scanId }, include: { targets: true } });
    if (!scan || scan.organizationId !== ctx.organizationId) throw new Error("Scan not found");
    const targetAssetIds = new Set(scan.targets.map((t) => t.assetId));
    let count = 0;
    for (const f of findings) {
      if (!targetAssetIds.has(f.assetId)) throw new Error(`finding asset ${f.assetId} is not a target of this scan`);
      if (!/^[1-5]$/.test(f.severity)) throw new Error("severity must be 1-5");
      if (!f.title || !f.qid) throw new Error("qid and title are required");
      const exists = await tx.finding.findUnique({
        where: { scanId_assetId_qid: { scanId, assetId: f.assetId, qid: f.qid } },
      });
      if (exists) continue; // dedupe: re-ingest is a no-op
      await tx.finding.create({
        data: {
          scanId, assetId: f.assetId, organizationId: ctx.organizationId,
          qid: f.qid, cveId: f.cveId ?? null, severity: f.severity, pciSeverity: f.pciSeverity ?? null,
          title: f.title, description: f.description, threat: f.threat, impact: f.impact, result: f.result,
        },
      });
      count += 1;
    }
    if (count > 0) await recordAudit(ctx, "finding.ingested", "Scan", scanId, undefined, { count }, undefined, tx);
    return { count };
  });
}

export async function listFindings(ctx: TenantContext, scanId: string): Promise<unknown[]> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.finding.findMany({ where: { scanId, organizationId: ctx.organizationId }, orderBy: [{ severity: "desc" }, { qid: "asc" }] })
  );
}

/** Dev/test dispatch: issue manifest → simulated scanner → ingest → complete. */
export async function runScanWithSimulatedScanner(ctx: TenantContext, scanId: string): Promise<{ findings: number }> {
  await transitionScanStatus(ctx, scanId, "RUNNING");
  const { manifest } = await issueScanManifest(ctx, scanId);
  const results = await simulatedScanner(manifest);
  const all = results.flatMap((r) => r.findings);
  const { count } = await ingestFindings(ctx, scanId, all);
  await transitionScanStatus(ctx, scanId, "COMPLETED");
  return { findings: count };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/findings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement the ingestion route**

Create `portal/src/app/api/v1/scans/[scanId]/findings/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { ingestFindings, listFindings } from "@/lib/scan/findings";
import { verifyScanManifest } from "@/lib/scan/manifest";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const auth = request.headers.get("authorization") ?? "";
  const manifestMatch = /^Bearer\s+(.+)$/i.exec(auth);
  let orgId: string | null = null;
  if (manifestMatch) {
    const verified = await verifyScanManifest(manifestMatch[1]);
    if (verified && verified.scanId === scanId) orgId = verified.organizationId;
    else return NextResponse.json({ error: "Invalid or expired manifest" }, { status: 401 });
  }
  const ctx = await tenantContextFromRequest(request);
  if (!orgId) {
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!can(ctx, "scan.run")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    orgId = ctx.organizationId;
  } else if (ctx && ctx.organizationId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.findings)) {
    return NextResponse.json({ error: "findings array is required" }, { status: 400 });
  }
  const scannerCtx = ctx ?? { userId: "scanner", organizationId: orgId, role: "scan_operator", isStaff: false, appMode: "dev" };
  try {
    const { count } = await ingestFindings(scannerCtx, scanId, body.findings);
    return NextResponse.json({ count }, { status: 201 });
  } catch (err) {
    return routeErrorResponse(err, { notFound: "Scan not found" });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scan.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { scanId } = await params;
  const findings = await listFindings(ctx, scanId);
  return NextResponse.json({ findings });
}
```

- [ ] **Step 6: Write + run the route test**

Create `portal/src/app/api/v1/scans/[scanId]/findings/route.test.ts` (mock pattern; assert: POST 401 with a bogus manifest; POST 201 with a user ctx for a scan.run role; POST 400 missing findings array; GET 403 for report_viewer). Follow the Task 5 route-test mock shape (txMock + `finding.findUnique`/`create`/`findMany` added). Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/app/api/v1/scans/\[scanId\]/findings/route.test.ts` — PASS.

- [ ] **Step 7: Commit**

```bash
git add portal/src/lib/scan/findings.ts portal/src/lib/scan/findings.test.ts portal/src/app/api/v1/scans
git commit -m "feat(portal): findings ingestion (dedupe by fingerprint) + simulated dispatch loop"
```

---

## Task 7: Report generation (Qualys-style)

**Files:**
- Create: `portal/src/lib/scan/report.ts`
- Test: `portal/src/lib/scan/report.test.ts`
- Create: `portal/src/app/api/v1/reports/[reportId]/route.ts`

**Interfaces:**
- Consumes: `getScan`, `listFindings`, `Finding`/`Scan`/`ScanTarget` models.
- Produces:
  - `buildReport(ctx, scanId): Promise<Report>` — RLS tx: scan must exist + status COMPLETED (else `ReportGuardError`); upsert Report by scanId (idempotent — rebuild overwrites the summary); computes the §5.1 summary from findings: `hosts` (distinct target assetIds), `vulnerabilities` (count), `averageRisk` (mean of numeric severity 1-5), `bySeverity` (counts per 1-5), `byPciSeverity` (High/Medium/Low counts), `compliance` = PASSED when no severity-4/5 findings else FAILED; audit `report.generated`.
  - `getReport(ctx, reportId): Promise<Report | null>` — org-scoped with attestation.
  - `ReportGuardError` exported.

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/scan/report.test.ts` (real DB; seed scan via service, ingest two findings via `ingestFindings`, then build):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets, transitionScanStatus } from "@/lib/scan/service";
import { ingestFindings } from "@/lib/scan/findings";
import { buildReport, getReport, ReportGuardError } from "@/lib/scan/report";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG = "org_report_0001";
const USER = "user_report_0001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}
const ctx: TenantContext = { userId: USER, organizationId: ORG, role: "report_viewer", isStaff: false, appMode: "prod" };

let assetId = "";

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const t of ["ReportAttestation", "Report", "Finding", "ScanTarget", "Scan", "AuditEvent", "Asset"]) {
      await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [ORG]);
    }
    await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [USER]);
  } finally { await admin.end(); }
}

describe("report generation", () => {
  let scanId = "";
  beforeAll(async () => {
    await adminWipe();
    await withTenant(ORG, (tx) => tx.organization.create({ data: { id: ORG, name: "Report Org" } }));
    await withTenant(ORG, (tx) => tx.user.create({ data: { id: USER, idpId: "kc-report", email: "r@x.com" } }));
    assetId = (await withTenant(ORG, (tx) => tx.asset.create({ data: { id: "asset_report_1", organizationId: ORG, type: "ipv4", canonicalIdentifier: "10.3.3.3", lifecycleState: "active", verificationState: "verified" } }))).id;
    scanId = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "report scan", assetIds: [assetId] })).id;
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, scanId, "RUNNING");
    await ingestFindings({ ...ctx, role: "scan_operator" }, scanId, [
      { assetId, qid: "q1", severity: "4", pciSeverity: "High", title: "TLS weak" },
      { assetId, qid: "q2", severity: "2", pciSeverity: "Low", title: "Banner" },
    ]);
    await transitionScanStatus({ ...ctx, role: "scan_operator" }, scanId, "COMPLETED");
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("builds a Qualys-style summary from findings (idempotent)", async () => {
    const report = await buildReport(ctx, scanId);
    expect(report.status).toBe("draft");
    expect((report.summary as any).hosts).toBe(1);
    expect((report.summary as any).vulnerabilities).toBe(2);
    expect((report.summary as any).bySeverity).toEqual({ "2": 1, "4": 1 });
    expect((report.summary as any).byPciSeverity).toEqual({ High: 1, Low: 1 });
    expect((report.summary as any).compliance).toBe("FAILED"); // severity-4 present
    const again = await buildReport(ctx, scanId);
    expect(again.id).toBe(report.id); // upsert by scanId — no duplicate report
  });

  it("rejects building a report for a non-completed scan", async () => {
    const pending = (await createScanFromAssets({ ...ctx, role: "scan_operator" }, { name: "pending", assetIds: [assetId] })).id;
    await expect(buildReport(ctx, pending)).rejects.toBeInstanceOf(ReportGuardError);
  });

  it("is tenant-scoped and audited", async () => {
    const report = await buildReport(ctx, scanId);
    const other: TenantContext = { userId: USER, organizationId: "org_report_0002", role: "report_viewer", isStaff: false, appMode: "prod" };
    expect(await getReport(other, report.id)).toBeNull();
    const audits = await withTenant(ORG, (tx) => tx.auditEvent.findMany({ where: { action: "report.generated", resourceId: report.id } }));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/report.test.ts`
Expected: FAIL — module `@/lib/scan/report` not found.

- [ ] **Step 3: Implement the report service**

Create `portal/src/lib/scan/report.ts`:
```ts
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { listFindings } from "@/lib/scan/findings";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma, Report } from "@/lib/generated/prisma";

export class ReportGuardError extends Error {}

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}

export async function buildReport(ctx: TenantContext, scanId: string): Promise<Report> {
  return withTenant(ctx.organizationId, async (tx) => {
    const scan = await tx.scan.findUnique({ where: { id: scanId } });
    if (!scan || scan.organizationId !== ctx.organizationId) throw new Error("Scan not found");
    if (scan.status !== "COMPLETED") throw new ReportGuardError("report requires a COMPLETED scan");
    const findings = await listFindings(ctx, scanId);
    const bySeverity: Record<string, number> = {};
    const byPci: Record<string, number> = {};
    let total = 0;
    for (const f of findings) {
      const sev = String(f.severity);
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
      if (f.pciSeverity) byPci[f.pciSeverity] = (byPci[f.pciSeverity] ?? 0) + 1;
      total += Number(sev);
    }
    const hosts = new Set(findings.map((f) => f.assetId)).size;
    const averageRisk = findings.length ? Number((total / findings.length).toFixed(2)) : 0;
    const hasCritical = findings.some((f) => Number(f.severity) >= 4);
    const summary = {
      hosts,
      vulnerabilities: findings.length,
      averageRisk,
      bySeverity,
      byPciSeverity: byPci,
      compliance: hasCritical ? "FAILED" : "PASSED",
    };
    const existing = await tx.report.findUnique({ where: { scanId } });
    const report = existing
      ? await tx.report.update({ where: { id: existing.id }, data: { summary: summary as unknown as Prisma.InputJsonValue } })
      : await tx.report.create({ data: { scanId, organizationId: ctx.organizationId, status: "draft", summary: summary as unknown as Prisma.InputJsonValue } });
    await recordAudit(ctx, "report.generated", "Report", report.id, undefined, summary, undefined, tx);
    return report;
  });
}

export async function getReport(ctx: TenantContext, reportId: string): Promise<(Report & { attestation: unknown }) | null> {
  return withTenant(ctx.organizationId, (tx) =>
    tx.report.findUnique({ where: { id: reportId }, include: { attestation: true } })
  );
}
```

Create `portal/src/app/api/v1/reports/[reportId]/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { getReport } from "@/lib/scan/report";

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "report.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { reportId } = await params;
  const report = await getReport(ctx, reportId);
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json(report);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/report.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/scan/report.ts portal/src/lib/scan/report.test.ts portal/src/app/api/v1/reports
git commit -m "feat(portal): Qualys-style report generation (summary aggregation, idempotent)"
```

---

## Task 8: QA attestation gate

**Files:**
- Modify: `portal/src/lib/scan/report.ts` (add submit/attest)
- Test: `portal/src/lib/scan/report.test.ts` (append)
- Create: `portal/src/app/api/v1/reports/[reportId]/attest/route.ts`
- Test: `portal/src/app/api/v1/reports/[reportId]/attest/route.test.ts`

**Interfaces:**
- Consumes: `Report`/`ReportAttestation` models, `recordAudit`, `getAppMode`.
- Produces:
  - `submitReport(ctx, reportId): Promise<Report | null>` — org-scoped; DRAFT → SUBMITTED; writes a ReportAttestation row (status submitted, reviewedById ctx.userId); audit `report.submitted`.
  - `attestReport(ctx, reportId, opts?: { reason?: string }): Promise<Report | null>` — SUBMITTED → ATTESTED (final); updates attestation (status attested, reason, reviewedAt now); audit `report.attested`. In `prod`, only staff/`report.attest` can attest (gate); in dev/test any report.view role can (relaxed per §6).
  - `isReportFinal(report): boolean` — `report.status === "attested"` (used by exit tests to prove the prod rule).

- [ ] **Step 1: Append the failing tests to `report.test.ts`**

```ts
import { submitReport, attestReport, isReportFinal } from "@/lib/scan/report";

describe("QA attestation gate", () => {
  it("report is not final until attested; prod requires staff for attest", async () => {
    const report = await buildReport(ctx, scanId);
    expect(isReportFinal(report)).toBe(false);
    const submitted = await submitReport(ctx, report.id);
    expect(submitted?.status).toBe("submitted");
    // report_viewer (non-staff) in prod cannot attest
    await expect(attestReport(ctx, report.id)).rejects.toThrow(/attest/);
    const staff: TenantContext = { ...ctx, isStaff: true };
    const attested = await attestReport(staff, report.id);
    expect(attested?.status).toBe("attested");
    expect(isReportFinal(attested!)).toBe(true);
  });

  it("attestation transitions are guarded (draft → attested rejected)", async () => {
    const fresh = await buildReport(ctx, scanId);
    const staff: TenantContext = { ...ctx, isStaff: true };
    await expect(attestReport(staff, fresh.id)).rejects.toThrow(/submitted/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/report.test.ts`
Expected: FAIL — `submitReport` not exported.

- [ ] **Step 3: Implement the gate functions**

In `portal/src/lib/scan/report.ts`, append:
```ts
import { getAppMode } from "@/lib/tenant";

export async function submitReport(ctx: TenantContext, reportId: string): Promise<Report | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const report = await tx.report.findUnique({ where: { id: reportId } });
    if (!report) return null;
    if (report.status !== "draft") throw new ReportGuardError("only draft reports can be submitted");
    const attestation = await tx.reportAttestation.create({
      data: { reportId, organizationId: ctx.organizationId, status: "submitted", reviewedById: ctx.userId },
    });
    const updated = await tx.report.update({ where: { id: reportId }, data: { status: "submitted", attestationId: attestation.id } });
    await recordAudit(ctx, "report.submitted", "Report", reportId, { status: report.status }, { status: "submitted" }, undefined, tx);
    return updated;
  });
}

export async function attestReport(
  ctx: TenantContext,
  reportId: string,
  opts?: { reason?: string }
): Promise<Report | null> {
  return withTenant(ctx.organizationId, async (tx) => {
    const report = await tx.report.findUnique({ where: { id: reportId }, include: { attestation: true } });
    if (!report) return null;
    if (report.status !== "submitted") throw new ReportGuardError("only submitted reports can be attested");
    if (getAppMode() === "prod" && !ctx.isStaff) throw new ReportGuardError("attestation requires a staff reviewer in prod");
    await tx.reportAttestation.update({
      where: { id: report.attestation!.id },
      data: { status: "attested", reason: opts?.reason ?? null, reviewedAt: new Date() },
    });
    const updated = await tx.report.update({ where: { id: reportId }, data: { status: "attested" } });
    await recordAudit(ctx, "report.attested", "Report", reportId, { status: report.status }, { status: "attested" }, opts?.reason, tx);
    return updated;
  });
}

export function isReportFinal(report: { status: string }): boolean {
  return report.status === "attested";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/scan/report.test.ts`
Expected: PASS (2 new tests; 5 total in the file's two describes).

- [ ] **Step 5: Implement the attest route + route test**

Create `portal/src/app/api/v1/reports/[reportId]/attest/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { submitReport, attestReport } from "@/lib/scan/report";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "report.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { reportId } = await params;
  const body = await request.json().catch(() => null);
  const status = typeof body?.status === "string" ? body.status : "";
  const reason = typeof body?.reason === "string" ? body.reason : undefined;
  try {
    let report;
    if (status === "submitted") report = await submitReport(ctx, reportId);
    else if (status === "attested") report = await attestReport(ctx, reportId, { reason });
    else return NextResponse.json({ error: "status must be submitted or attested" }, { status: 400 });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    return NextResponse.json(report);
  } catch (err) {
    return routeErrorResponse(err);
  }
}
```

Create `portal/src/app/api/v1/reports/[reportId]/attest/route.test.ts` (mock pattern; assert: 400 invalid status; 404 unknown report; 403 for a non-report.view role; 200 submit for report_viewer; 200 attest — with `vi.stubEnv("APP_MODE","test")` for the non-staff attest path). Run: `npx --cache /home/cchock/projects/.npm-cache vitest run src/app/api/v1/reports/\[reportId\]/attest/route.test.ts` — PASS.

- [ ] **Step 6: Commit**

```bash
git add portal/src/lib/scan/report.ts portal/src/lib/scan/report.test.ts portal/src/app/api/v1/reports
git commit -m "feat(portal): QA attestation gate — report not final until attested (prod-enforced)"
```

---

## Task 9: Exit criteria + handoff

**Files:**
- Create: `portal/src/lib/scan/exit.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: everything from Tasks 1-8 + `portal/spec/openapi.yaml`.
- Produces: the exit proof + the Phase 3b handoff note.

- [ ] **Step 1: Write the exit criteria test**

Create `portal/src/lib/scan/exit.test.ts` (real DB harness; two orgs):
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { prisma } from "@/lib/prisma-client";
import { setRlsContext } from "@/lib/tenant";
import { createScanFromAssets, getScan, transitionScanStatus } from "@/lib/scan/service";
import { issueScanManifest, verifyScanManifest } from "@/lib/scan/manifest";
import { ingestFindings, runScanWithSimulatedScanner } from "@/lib/scan/findings";
import { buildReport, submitReport, attestReport, isReportFinal } from "@/lib/scan/report";
import type { TenantContext } from "@/lib/tenant";
import type { Prisma } from "@/lib/generated/prisma";

const ORG_A = "org_scan_exit_a_001";
const ORG_B = "org_scan_exit_b_001";
const USER_A = "user_scan_exit_a_001";
const USER_B = "user_scan_exit_b_001";

function withTenant<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await setRlsContext(organizationId, tx); return fn(tx); });
}
const ctxA: TenantContext = { userId: USER_A, organizationId: ORG_A, role: "scan_operator", isStaff: false, appMode: "prod" };
const staffA: TenantContext = { ...ctxA, isStaff: true };
const ctxB: TenantContext = { userId: USER_B, organizationId: ORG_B, role: "scan_operator", isStaff: false, appMode: "prod" };

let assetA = "";

async function adminWipe(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL! });
  await admin.connect();
  try {
    for (const o of [ORG_A, ORG_B]) {
      for (const t of ["ReportAttestation", "Report", "Finding", "ScanTarget", "Scan", "AuditEvent", "Asset"]) {
        await admin.query(`DELETE FROM "${t}" WHERE "organizationId" = $1`, [o]);
      }
      await admin.query(`DELETE FROM "Organization" WHERE id = $1`, [o]);
    }
    await admin.query(`DELETE FROM "User" WHERE id IN ($1, $2)`, [USER_A, USER_B]);
  } finally { await admin.end(); }
}

describe("phase 3 exit criteria", () => {
  let scanId = "";
  beforeAll(async () => {
    await adminWipe();
    for (const o of [ORG_A, ORG_B]) await withTenant(o, (tx) => tx.organization.create({ data: { id: o, name: `Exit ${o}` } }));
    await withTenant(ORG_A, (tx) => tx.user.create({ data: { id: USER_A, idpId: "kc-exit-a", email: "a@x.com" } }));
    await withTenant(ORG_B, (tx) => tx.user.create({ data: { id: USER_B, idpId: "kc-exit-b", email: "b@x.com" } }));
    assetA = (await withTenant(ORG_A, (tx) => tx.asset.create({ data: { id: "asset_exit_a_1", organizationId: ORG_A, type: "ipv4", canonicalIdentifier: "10.9.9.9", lifecycleState: "active", verificationState: "verified" } }))).id;
  });
  afterAll(async () => { await adminWipe(); await prisma.$disconnect(); });

  it("scan → manifest → findings → report traces every finding to its asset and scan", async () => {
    scanId = (await createScanFromAssets(ctxA, { name: "exit scan", assetIds: [assetA] })).id;
    const { findings } = await runScanWithSimulatedScanner(ctxA, scanId);
    expect(findings).toBeGreaterThanOrEqual(1);
    const scan = await getScan(ctxA, scanId);
    expect(scan?.status).toBe("COMPLETED");
    const fRows = await withTenant(ORG_A, (tx) => tx.finding.findMany({ where: { scanId } }));
    expect(fRows.length).toBeGreaterThanOrEqual(1);
    for (const f of fRows) {
      expect(f.scanId).toBe(scanId);
      expect(scan?.targets.some((t) => t.assetId === f.assetId)).toBe(true);
    }
  });

  it("report is NOT final until QA-attested (prod)", async () => {
    const report = await buildReport(ctxA, scanId);
    expect(isReportFinal(report)).toBe(false);
    await submitReport(ctxA, report.id);
    const attested = await attestReport(staffA, report.id);
    expect(isReportFinal(attested!)).toBe(true);
  });

  it("cross-tenant isolation: org B sees none of org A's scans, findings, or reports", async () => {
    expect(await getScan(ctxB, scanId)).toBeNull();
    const bFindings = await withTenant(ORG_B, (tx) => tx.finding.findMany({ where: { scanId } }));
    expect(bFindings).toHaveLength(0);
    const bReports = await withTenant(ORG_B, (tx) => tx.report.findMany({}));
    expect(bReports).toHaveLength(0);
  });

  it("every Phase 3 contract path maps to a route file", async () => {
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
    const phase3Paths = Object.keys(spec.paths).filter((p) => /^\/(scans|reports)(\/|$)/.test(p));
    expect(phase3Paths.length).toBeGreaterThanOrEqual(5);
    for (const p of phase3Paths) {
      const segments = p.split("/").filter(Boolean).map((s) => (s.startsWith("{") ? `[${s.slice(1, -1)}]` : s));
      const expected = path.join(routeDir, ...segments, "route.ts");
      expect(routeFiles.has(expected), `no route file for ${p}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the exit test + full suite**

Run: `npx --cache /home/cchock/projects/.npm-cache vitest run`
Expected: PASS — all tests (baseline 228 + 2 scan-rls + 5 scan service + 3 manifest + 5 route + 3 findings + 3 findings-route + 3 report + 2 attest + 4 exit + 1 rbac = expect ~259).

- [ ] **Step 3: Update AGENTS.md**

Replace the `- **NEXT:** Scans + Scan Reports ...` line with:

```markdown
- **Phase 3 DONE** (scans + scan reports): Scan/ScanTarget/Finding/Report(+Attestation) models + RLS, scan creation from selected assets (lightweight scope snapshot), HMAC-signed expiring scan manifest, findings ingestion (fingerprint-deduped), Qualys-style report generation, QA attestation gate (report final only when attested in prod), scan/report API + contract. Simulated scanner (test double) drives the dev/test loop.
- **NEXT:** Phase 3b = wire the real Python scanner service (scanner/) to the manifest + ingestion contract (consumer + findings write-back); then Phase 4 = versioned scope & authorization + dispute flow.
```

Update the test-count line to the fresh full-suite result. Add the `MANIFEST_SECRET` env note to Environment notes (`MANIFEST_SECRET` required in prod; dev fallback documented).

- [ ] **Step 4: Commit**

```bash
git add portal/src/lib/scan/exit.test.ts AGENTS.md
git commit -m "test(portal): Phase 3 exit criteria + docs: Phase 3b handoff"
```

---

## Self-Review

**Spec coverage:** §2 control-plane/executor split → Tasks 4/6 (manifest + ingestion contract, simulated scanner); §4 Scan/ScanTarget/Finding/Report/ReportAttestation → Task 2; §5 scan flow steps 4-9 → Tasks 3-8 (asset-selected scope, manifest, findings, report; QA gate); §5.1 report structure → Task 7 (summary + severity aggregation; attestation section → Task 8); §6 APP_MODE gates → Tasks 3 (verified-asset in prod) + 8 (attestation in prod); §10 build order reordered per user directive → Phase 3 = scans + reports first. Deferred (documented): real scanner wiring (Phase 3b), versioned scope + attestation + dispute flow + congratulations email (Phase 4), credentialed scans, NVD mirror ops.

**Placeholder scan:** every task carries code or exact commands; no TBD/TODO. Task 6's route test and Task 8's route test are specified by template + enumerated assertions (same pattern as the user-center plan's accepted approach).

**Type consistency:** `createScanFromAssets`/`getScan`/`transitionScanStatus` (Task 3) used verbatim in Tasks 4-9; `issueScanManifest`/`verifyScanManifest`/`simulatedScanner` (Task 4) in Tasks 6/9; `ingestFindings`/`listFindings` (Task 6) in Tasks 7/9; `buildReport`/`getReport`/`submitReport`/`attestReport`/`isReportFinal`/`ReportGuardError` (Tasks 7-8) in Task 9; `ScanGuardError` (Task 3) mapped by `routeErrorResponse` (existing helper). RBAC actions `scan.run` (existing) + `scan.view` (Task 3) used by Task 5 routes. `withTenant`/`adminWipe` harness consistent across all test files; fixed ids unique per suite.

## Handoff note for Phase 3b (scanner service integration)

The contract Phase 3 tests is: (1) `POST /api/v1/scans/{scanId}/findings` accepting `Authorization: Bearer <manifest>` with `{ findings: [...] }` (shape in the OpenAPI `FindingIngest` schema) — the real scanner verifies the manifest, runs the black-box scan per target, and posts findings; (2) `PATCH /api/v1/scans/{scanId}` `{status: RUNNING|COMPLETED|FAILED}` for lifecycle updates; (3) the manifest format (payload `<b64url JSON>. <HMAC hex>`) issued by `issueScanManifest`. Phase 3b implements the scanner-side consumer in `scanner/` (FastAPI) against these three contracts, replacing `simulatedScanner`, and wires the dispatch trigger. The NVD/CVE scoring in `scanner/app/scoring/` feeds `cveId`/severity into the ingested findings.
