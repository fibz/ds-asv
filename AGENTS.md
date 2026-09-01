# ds-asv — Agent Instructions

## Project state (verified 2026-08-30)

- **What:** Commercial PCI DSS compliance portal. SaaS, multi-tenant (nested orgs — QSA resellers + merchants).
- **Stack:** Next.js/TS portal (`portal/`) + Python/FastAPI scanner (`scanner/`) + PostgreSQL (RLS). Self-hosted Keycloak (OIDC), Vault, MinIO/S3.
- **Repo:** https://github.com/fibz/ds-asv — public, branch `main`. Pushed and in sync (commit `42fc3d5`).
- **Phase 1 DONE** (tenant & identity foundation): RLS multi-tenancy (non-superuser `asv_app` role), Keycloak OIDC header auth + salted API keys, RBAC (`hasRole`/`can`/`requireRole`), single-use expiring invitations, append-only audit (DB-enforced), cross-tenant isolation tests.
- **Phase 2 DONE** (asset inventory): Asset/AssetVerification/AssetImport models + RLS, identifier normalization (ipv4/ipv6/cidr/fqdn), CSV import w/ preview + downloadable invalid rows + idempotency, dedupe (duplicates never create extra assets), lifecycle/retire (referenced-asset history preserved — row + audit + verification, never hard-deleted), DNS TXT/manual verification, API routes (CRUD/import/retire/verification), assets UI (list/filter/detail + import), ApiKey RLS revival. **273/273 tests green** (`npx vitest run` in `portal/`).
- **Design docs:** `docs/superpowers/specs/2026-08-29-ds-asv-pci-portal-design.md` (approved). Phase 1 plan: `docs/superpowers/plans/2026-08-29-phase1-tenant-identity.md`. Phase 2 plan: `docs/superpowers/plans/2026-08-30-phase2-asset-inventory.md`.
- **User Center DONE** (hub): org profile + contacts, team management (members/roles/removal w/ last-owner guard), session registry (hash-only tokens, revoke = blocked at auth), audit trail API + UI baseline (`/settings`, `/team`, `/access`, `/audit`). API contract: `portal/spec/openapi.yaml` (org/team/sessions/audit/invitations) — handoff artifact for the UI stream (Codex / UI dev).
- **Phase 3 DONE** (scans + scan reports): Scan/ScanTarget/Finding/Report(+Attestation) models + RLS, scan creation from selected assets (lightweight scope snapshot), HMAC-signed expiring scan manifest, findings ingestion (fingerprint-deduped), Qualys-style report generation, QA attestation gate (report final only when attested in prod), scan/report API + contract. Simulated scanner (test double) drives the dev/test loop.
- **Phase 3b DONE** (scanner service integration): real Python scanner (`scanner/`) wired to the Phase 3 manifest + ingestion contract. It consumes `POST /v1/manifests`, verifies the signed manifest, runs a black-box scan per target, maps findings, and writes findings + lifecycle back to the portal (post + patch). Portal full suite: 278 tests (`npx vitest run` in `portal/`). Scanner full suite green (`pytest tests/` in `scanner/`).
- **Phase 4 DONE** (versioned scope & authorization + dispute flow): ScopeSet/ScopeVersion/ScopeItem (immutable snapshots, draft→submitted→approved, deterministic content hash) + Authorization (HMAC-signed statement + scope-version hash, verifiable) + Dispute models, all with RLS; scope service + prod scope-approval gate on scan creation (no scan without an approved scope version — assetInApprovedScope); signed authorization issuance/verification; dispute flow (raise w/ justification, QA staff moderation with a prod staff gate); scope/auth/dispute API routes + contract; exit criteria (gate → approved scan → signed authorization → staff moderation end-to-end + contract conformance). Portal full suite: 322 tests (`npx vitest run` in `portal/`).
- **NEXT:** Phase 5 = scanning UI wiring (assets → scope → scan), report finalization gate wiring (report final only when QA-attested AND its scope version is approved — attestation gate exists, surface the scope link), and the CVE/scoring source (VulDB or Kali/Greenbone local DBs — deferred from Phase 3b, feeds cveId/severity/pciSeverity into findings).

## Environment notes

- **Test DB:** docker postgres `ds-asv-pg` on port 5433, db `asv_portal`, roles `asv` (superuser/admin, via `ADMIN_DATABASE_URL`) and `asv_app` (app, RLS-subject, via `DATABASE_URL`). `.env` in `portal/` is gitignored — copy from `.env.example` and set real passwords for local work.
- **pnpm is broken in this sandbox** (read-only store) — use `npm`/`npx`. Cache: `npm install --cache /home/cchock/projects/.npm-cache`.
- **`MANIFEST_SECRET`** is required in prod (scan-manifest HMAC signing/verification); dev falls back to `"dev-manifest-secret"` (documented in `src/lib/scan/manifest.ts`).
- **Prisma 7 `migrate dev` is non-interactive-unfriendly** — use `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` + `migrate deploy` (Prisma 7.10 removed `--from-url`; `--from-config-datasource` reads the admin datasource pinned in `prisma.config.ts`). Generated client is gitignored: run `npx prisma generate` after a clean clone.
- **After any `migrate diff`**, verify the partial unique index `Asset_active_unique` (`organizationId`, `type`, `canonicalIdentifier`) `WHERE "lifecycleState" <> 'retired'` is still present in the generated migration — `migrate diff` may drop it as drift since partial indexes are not expressible in `schema.prisma`. Re-append it if the diff drops it.
- **App connects as `asv_app`** (fail-closed grants, RLS always ON). Admin ops (test seeding/cleanup) go through a second client from `ADMIN_DATABASE_URL`.
- **`set_config('app.tenant_id', ...)` is transaction-scoped** — RLS context must be set inside `prisma.$transaction` with the tx client.
- **`next build` requires `APP_MODE=prod`** (prod-lock guard, spec §6). CI must export it.

## GitHub push gotchas (learned the hard way)

- **Secret scanner blocks pushes.** It flags fake examples: `sk_live_*` placeholders (openapi.yaml), `postgresql://user:pass@` URLs (even localhost), `PASSWORD 'x'` in migrations. Sanitize to `CHANGE_ME` **in history** (`git filter-branch`) — a tip-only fix does NOT clear it.
- **Check the FULL push error first**: `git push > /tmp/push.txt 2>&1; cat /tmp/push.txt` — it names the exact commit/path/secret type. Read that before guessing.
- `gh` token lacks `delete_repo` scope. Credential helper is per-repo: `git config credential.helper "!gh auth git-credential"`.
- Reference dump (sample Qualys PDF, ASV User Flow.drawio, t3 JS/SQL) was removed from git — kept tripping the scanner. Backed up at `/home/cchock/projects/ds-asv-ref-backup/`.

## Working agreements (user explicitly called these out)

1. **NEVER report system state from memory, cache, or earlier in the session.** Git status, test counts, push state, "clean" — always re-run the check at that moment. Cache-recall of status is a bug. **Do not refer to cache at all.**
   - **Exception — key data (read the FILE, never the cache):** durable facts live in AGENTS.md / MEMORY.md (repo URL, DB roles/ports, next-phase, follow-up lists, backup paths). When you need them, **read the file** — do not recall them from memory. If a stored fact looks stale or contradicts a fresh check, the fresh check wins and the file should be updated.
2. **Check the actual error/output before responding** — don't guess, don't offer menus of guesses.
3. **Shorter, plainer answers.** User prefers direct + visual. No walls of text, no status-table spam.
4. **Make calls that are mine to make.** Only ask when only the user can answer.
5. User makes spelling errors — read for intent, never nitpick.

## Known follow-ups (deferred, tracked)

- Bind cookie session ids into the Session registry (registry is ready) — dashboard layout is header-auth only.
- Staff identity wiring: resolveTenantContext hardcodes isStaff:false — the prod staff gates (dispute moderation, report attestation) are unreachable in prod until a real staff-identity path (e.g. Keycloak role claim → isStaff) lands. Fail-closed (denies everyone) until then.
- Hardcoded dev DB passwords → env/Vault bootstrap before any non-dev run.
- Pre-existing tsc errors (next.config.ts duplicate output; normalize.ts BigInt target) — the stale clerkId error was fixed by the Clerk strip.
