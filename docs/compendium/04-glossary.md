# 04 — Glossary

Plain-language definitions for the terms you'll meet. Sorted alphabetically.

## A

**ASV** — Approved Scanning Vendor. A PCI-recognized company (like Qualys) authorized to run external vulnerability scans that satisfy PCI DSS Requirement 11.2. This product builds the scanner + report machinery an ASV uses.

**Asset** — a system a tenant owns and wants scanned: an IPv4/IPv6 address, a CIDR range, or an FQDN. Stored canonically (normalized) so `10.0.0.1` and `010.0.0.1` are the same asset. Durable — assets are retired, never deleted.

**Attestation** — the human QA sign-off that a scan report is compliant. A report is not final until attested (enforced in prod). See also **QA attestation gate**.

**Audit event** — an append-only record of a security-relevant action (who, what, when, before/after). Never updated or deleted; the only write path is `recordAudit`.

## C

**CIDR** — a range of IP addresses written as `203.0.113.0/24`. In this product, CIDRs are *boundaries* for scoping — they are never expanded into individual-IP scan profiles.

**Compliance gate** — a business rule that must hold before an action is allowed (e.g. "assets must be verified before scanning", "report must be attested before it's final"). Relaxed in `dev`/`test` via `APP_MODE`, enforced in `prod`.

**Control plane** — the Next.js portal: auth, tenants, assets, scans, reports, UI, API. Owns all customer data and decisions; never runs the actual scan.

**CVSS** — Common Vulnerability Scoring System, a 0-10 severity score for vulnerabilities. Mapped to PCI severity bands (Low 0-3.9 / Medium 4-6.9 / High 7-10).

## F

**Finding** — one vulnerability discovered on one scan target (identified by a QID or CVE). Fields include severity (1-5), PCI severity, title, description, threat, impact, result. Deduped by fingerprint `(scanId, assetId, qid)`.

## I

**Idempotent** — an operation that can be repeated safely with the same result. Examples: CSV import replays short-circuit instead of creating duplicate assets; findings re-ingestion is a no-op; report rebuild overwrites, never duplicates.

## K

**Keycloak** — the self-hosted identity provider (OIDC). Issues the JWTs the portal verifies for human auth. Replaced the earlier Clerk choice; the machine-auth path is X-API-Key + scopes.

## M

**Manifest** — the signed, short-lived (15-minute) token the control plane issues to the scanner describing exactly what to scan: `{ scanId, organizationId, targets, issuedAt, expiresAt, nonce }`, HMAC-SHA256 signed. The scanner verifies it, runs the scan, and writes findings back. Minimal and expiring by design — the scanner never sees the tenant's full dataset.

**Multi-tenancy** — one deployed system serving many customer organizations (tenants), with hard isolation between them. Enforced at the database level with RLS.

## Q

**QA attestation gate** — the workflow step where a reviewer attests a generated report before it can be considered final/compliant (report status `draft → submitted → attested`). This is what distinguishes a defensible compliance report from a plain port-scan dump.

**QID** — Qualys ID, the vulnerability identifier used in the Qualys report format this product replicates. QIDs group into categories; findings reference a QID and optionally a CVE.

**QSA** — Qualified Security Assessor. A company (the *parent* org in the nesting model) that assesses merchants' PCI compliance; its merchants are child orgs.

## R

**RBAC** — role-based access control. Roles: `organization_owner`, `security_admin`, `asset_manager`, `scan_operator`, `report_viewer`, `billing_admin`. Checked via `can()` / `requireRole()`.

**RLS** — Row-Level Security. PostgreSQL's per-row access control. Every tenant table carries `organizationId`; RLS policies filter every query to rows matching the session's `app.tenant_id`. The app connects as `asv_app`, which is always subject to RLS. See 01.

**Revoke** — the way access is removed without deleting history: a session or API key gets `revokedAt`, assets get `retired`, and the record stays for audit.

## S

**Scan** — one run of the scanner against a snapshot of selected assets. Status flow: `PENDING → RUNNING → COMPLETED | FAILED`.

**Scan target** — an immutable snapshot row capturing which assets a scan covered (type + canonical identifier). Changing the asset list later does not change what a completed scan actually scanned — that's the compliance value.

**Scope** — the set of systems included in a compliance engagement. Lightweight scope today = the selected-asset list snapshotted into scan targets. Versioned, attested scope (the formal immutability flow) is a later phase.

**Session** — a record of one authenticated access, keyed by the sha256 hash of the bearer token. Revoking it blocks that token on the next request.

## T

**Tenant** — a customer organization and its data, isolated from every other organization. `organizationId` appears on every tenant table.

**Tenant context** — the transaction-scoped `app.tenant_id` set before tenant queries run. See `withTenant` and the RLS deep-dive in 01.

## V

**Verification** — proving a tenant owns an asset (DNS TXT or manual challenge) before it can be scanned in prod. Recorded in `AssetVerification`.

---

*If a term is missing or a definition is wrong, update this file — it's meant to be lived in.*
