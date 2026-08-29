# ds-asv — Agent Instructions

## Project state (verified 2026-08-30)

- **What:** Commercial PCI DSS compliance portal. SaaS, multi-tenant (nested orgs — QSA resellers + merchants).
- **Stack:** Next.js/TS portal (`portal/`) + Python/FastAPI scanner (`scanner/`) + PostgreSQL (RLS). Self-hosted Keycloak (OIDC), Vault, MinIO/S3.
- **Repo:** https://github.com/fibz/ds-asv — public, branch `main`. Pushed and in sync (commit `42fc3d5`).
- **Phase 1 DONE** (tenant & identity foundation): RLS multi-tenancy (non-superuser `asv_app` role), Keycloak OIDC header auth + salted API keys, RBAC (`hasRole`/`can`/`requireRole`), single-use expiring invitations, append-only audit (DB-enforced), cross-tenant isolation tests. **94/94 tests green** (`npx vitest run` in `portal/`).
- **Design docs:** `docs/superpowers/specs/2026-08-29-ds-asv-pci-portal-design.md` (approved). Phase 1 plan: `docs/superpowers/plans/2026-08-29-phase1-tenant-identity.md`.
- **NEXT:** Phase 2 = asset inventory (per build order: identity → assets → scope → scan → reporting+QA).

## Environment notes

- **Test DB:** docker postgres `ds-asv-pg` on port 5433, db `asv_portal`, roles `asv` (superuser/admin, via `ADMIN_DATABASE_URL`) and `asv_app` (app, RLS-subject, via `DATABASE_URL`). `.env` in `portal/` is gitignored — copy from `.env.example` and set real passwords for local work.
- **pnpm is broken in this sandbox** (read-only store) — use `npm`/`npx`. Cache: `npm install --cache /home/cchock/projects/.npm-cache`.
- **Prisma 7 `migrate dev` is non-interactive-unfriendly** — use `npx prisma migrate diff` + `migrate deploy`. Generated client is gitignored: run `npx prisma generate` after a clean clone.
- **App connects as `asv_app`** (fail-closed grants, RLS always ON). Admin ops (test seeding/cleanup) go through a second client from `ADMIN_DATABASE_URL`.
- **`set_config('app.tenant_id', ...)` is transaction-scoped** — RLS context must be set inside `prisma.$transaction` with the tx client.
- **`next build` requires `APP_MODE=prod`** (prod-lock guard, spec §6). CI must export it.

## GitHub push gotchas (learned the hard way)

- **Secret scanner blocks pushes.** It flags fake examples: `sk_live_*` placeholders (openapi.yaml), `postgresql://user:pass@` URLs (even localhost), `PASSWORD 'x'` in migrations. Sanitize to `CHANGE_ME` **in history** (`git filter-branch`) — a tip-only fix does NOT clear it.
- **Check the FULL push error first**: `git push > /tmp/push.txt 2>&1; cat /tmp/push.txt` — it names the exact commit/path/secret type. Read that before guessing.
- `gh` token lacks `delete_repo` scope. Credential helper is per-repo: `git config credential.helper "!gh auth git-credential"`.
- Reference dump (sample Qualys PDF, ASV User Flow.drawio, t3 JS/SQL) was removed from git — kept tripping the scanner. Backed up at `/home/cchock/projects/ds-asv-ref-backup/`.

## Working agreements (user explicitly called these out)

1. **NEVER report system state from memory or earlier in the session.** Git status, test counts, push state, "clean" — always re-run the check at that moment. Cache-recall of status is a bug.
   - **Exception — key data:** durable facts recorded in AGENTS.md / MEMORY.md (repo URL, DB roles/ports, next-phase, follow-up lists, backup paths, credentials locations) are authoritative and may be cited without re-verification — that's why they were written down. The rule targets *live system state*, not stored project facts. If a stored fact looks stale or contradicts a fresh check, the fresh check wins and the file should be updated.
2. **Check the actual error/output before responding** — don't guess, don't offer menus of guesses.
3. **Shorter, plainer answers.** User prefers direct + visual. No walls of text, no status-table spam.
4. **Make calls that are mine to make.** Only ask when only the user can answer.
5. User makes spelling errors — read for intent, never nitpick.

## Known follow-ups (deferred, tracked)

- ApiKey RLS + grants + route revival (Phase 2 FIRST task) — routes currently return 501.
- Cookie-session auth + sign-in UI replacement (Keycloak hosted login) — dashboard layout is header-auth only.
- Hardcoded dev DB passwords → env/Vault bootstrap before any non-dev run.
- Remaining Clerk UI imports (api/scanners route, dashboard pages).
- Pre-existing tsc errors (next.config.ts duplicate output; stale clerkId in api-keys page).
