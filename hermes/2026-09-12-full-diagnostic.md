# ds-asv — Full Diagnostic

Date: 2026-09-12
Scope: `/home/cchock/projects/ds-asv` (working tree, all branches, linked worktrees, both subprojects)
Method: every claim below was produced by a command run in this session. No recalled state.

## Verified-healthy baseline first

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (portal) | clean, exit 0 |
| `npx vitest run` (portal, DB up) | **68/68 files, 410 passed, 3 skipped** (413) |
| `make test` (scanner) | **86 passed** |
| `make test-integration` (scanner) | **5 passed** (real postgres, self-cleaning) |
| black / isort / flake8 / mypy (scanner) | all clean |
| Secrets in git | none tracked; `.env`, `greenbone.env`, `data/` correctly ignored |
| Prod guards | secret-bootstrap + prod-lock present on both sides |

So the code is in good shape. Everything below is drift, tooling, or unfinished migration — not broken logic.

---

## HIGH

### 1. Next.js 16.3.1 carries a critical unauthenticated RCE
`npm audit --omit=dev` → 5 vulnerabilities (4 high, 1 critical).

- `next 16.0.0 – 16.3.2`, severity **critical**:
  - GHSA-p293-qw3h-jr36 — Unauthenticated RCE on Windows-hosted servers
  - GHSA-2xp9-vwfh-vxw4 — Unauthenticated RCE in the Image Optimization API (AVIF)
  - Fix: `next@16.3.5` (outside the current stated range) — also bumps `eslint-config-next`.
- `mysql2 <=3.23.0`, severity **high** (auth-plugin downgrade leaking plaintext creds; zlib decompression-bomb DoS) — arrives via `@prisma/config` ← `prisma`. Build-time only in practice (see #13), but it shows up because `prisma` is in `dependencies`.

Only genuine security defect in the tree, and it's on the framework under a PCI product.

### 2. Three divergent lines of work, none merged — main is the stale ancestor

| Branch | Head | Date | vs main |
|---|---|---|---|
| `main` | `5cc6531` | 2026-09-06 | — (base) |
| `scanner-dashboard` | `d05c3cb` | 2026-09-06 | 21 ahead / 1 behind |
| `customer-portal` | `2eba98a` | 2026-09-09 | 12 ahead / 0 behind |
| `qsa-portal` | `5b6d949` | 2026-09-09 | 10 ahead / 0 behind |

- `customer-portal` holds the customer-portal split **and** the entire QSA portal (12 commits).
- **10 of those commits are unpushed** — `origin/customer-portal` only has `6c002f4`.
- `main` is fully contained in `customer-portal`, so `customer-portal` is a clean fast-forward candidate; `scanner-dashboard` is not (1 commit diverges).
- `qsa-portal` is a prefix of `customer-portal` — a redundant branch, not a distinct line.

### 3. Abandoned uncommitted work in Codex worktrees (data-loss risk)

| Worktree | State | Content |
|---|---|---|
| `~/.codex/worktrees/72cd/ds-asv` | `qsa-portal`, **dirty** | 5 modified auth files (+64/−11) incl. `keycloak.ts`, `session-cookie.ts`, sign-in page, login + callback routes; **untracked `deploy/` and `portal/Dockerfile`** |
| `~/.codex/worktrees/b25d/ds-asv` | **detached HEAD** @ `5cc6531`, dirty | 259 insertions in `scanners/client.tsx` — substantial scanners-UI rewrite; +18 in `page.tsx` |
| `~/.codex/worktrees/99bf/ds-asv` | detached @ `5cc6531` | clean |
| `~/.codex/worktrees/9f50/ds-asv` | detached @ `5cc6531` | clean |

The `deploy/` + `portal/Dockerfile` in 72cd exist nowhere else in the repo. The b25d rewrite sits on a detached HEAD, which `git worktree prune` can discard.

### 4. Portal test suite can't go green from a clean checkout
Sequence actually observed in this session:

- `ds-asv-pg` stopped → **32/68 test files failed** (ECONNREFUSED via Prisma), 1 failed / 248 passed / 164 skipped.
- `docker start ds-asv-pg` → **68/68 files, 410 passed / 3 skipped**.

Cause: the portal test DB is not defined anywhere in the repo. There is no compose file for it — it was created ad-hoc (`docker run`, confirmed via `docker inspect`: `POSTGRES_USER=asv`, db `asv_portal`, host port 5433) and was sitting exited for 38h. The 3 skips are `exit.live.test.ts`, which needs Keycloak (also exited).

---

## MEDIUM

### 5. The portal lint gate is ~97% noise from a stray build directory
`npx eslint .` → **656 errors / 6366 warnings**. Breakdown by file path:

- `portal/var/compliance-build/.next/**` — **634 errors + nearly all warnings** (generated Turbopack output)
- `portal/src/**` — **20 errors**
- `portal/vitest.config.mjs` — 2

The 20 real source errors: 18 × `@typescript-eslint/no-explicit-any` (`src/lib/audit.ts`, `src/lib/scan/report.test.ts` ×5, `ApiReference.tsx` ×3, `onboarding/page.tsx`, `playground/page.tsx`, `contract.test.ts` ×2, `org/exit.test.ts`, `scan/exit.test.ts`, `scope/exit.test.ts`), 1 × react-hooks cascading-`setState` (`src/components/playground/RequestBuilder.tsx:46`).

Root cause: `eslint.config.mjs` `globalIgnores` lists `.next/**`, `out/**`, `build/**`, `next-env.d.ts` — `var/**` is absent, and `build/**` does not match `var/compliance-build/`. Separately, `var/` and `var/compliance-build/` are **not** in `.gitignore` (only the nested `.next/` is, by the bare `.next/` rule).

### 6. Production builds are configured to write to an absolute system path
`portal/next.config.ts`:
```ts
distDir: process.env.NODE_ENV === "development" ? ".next" : "/var/compliance-build/.next"
```
A non-dev build writes to `/var/compliance-build/.next` at the filesystem root — outside the checkout, requiring root write access. It does not exist on this host, so builds have only ever been exercised in dev mode. The orphaned `portal/var/compliance-build/` (159 MB) is a leftover from an earlier relative-path version of this setting.

### 7. Scanner runs on a different Python than it ships on
| Source | Baseline |
|---|---|
| `scanner/AGENTS.md` | "Python 3.13 is the project and container runtime baseline" |
| `scanner/Makefile` | `PYTHON = python3.13` |
| `scanner/Dockerfile` | `FROM python:3.13-slim` |
| **`scanner/.venv`** | **Python 3.14.4** |
| **host** | `python3.13` **not installed** (only `/usr/bin/python3.14`) |

86 tests and all lint gates pass under 3.14, so this is silent — but you are validating on an interpreter you don't deploy.

### 8. No CI, no git hooks
- No `.github/workflows`, no `.gitlab-ci.yml`, no `Jenkinsfile`.
- `.git/hooks/` contains only `.sample` files.
- Every gate in both `AGENTS.md` files (tsc, vitest, black/isort/flake8/mypy, build-images, vault-dev) is manual.
- This is the reason findings #2, #3, #4 and #7 could accumulate unnoticed: 499 tests exist and nothing runs them automatically.
- `scanner/AGENTS.md` gate #5 (`make vault-dev && make vault-configure`) requires Docker + Vault and was **not** exercised here.

### 9. `AGENTS.md` is stale in checkable ways
| Claim in AGENTS.md | Live |
|---|---|
| Repo branch = `main` | live branch `customer-portal` |
| "373/373 portal tests green" | 413 total: 410 pass, 3 skip |
| "NEXT: scanner dashboard (resume)" | customer-portal + QSA work landed 2026-09-09 (12 commits) — not mentioned at all |
| "no CI" not mentioned | confirmed absent |

---

## LOW

10. **Dead salvaged modules.** From commit `a64e0be` ("Consolidate salvageable code"): `src/server/siem/wazuh.ts`, `src/server/compliance/checker.ts`, `src/server/waf/manager.ts`, `src/server/scanners/tempest.ts` — all **zero** imports in `src/`. 4/4 of `src/server/` is unreferenced.

11. **Stray routes wired into the nav.** `/playground`, `/onboarding`, `/(docs)/reference` are salvaged template pages, and `src/components/dashboard/sidebar.tsx:22-23` links Playground + Onboarding as real dashboard features.

12. **Duplicate route trees.** `(dashboard)/*` has 13 pages (incl. `compliance`, `payments`, `siem`, `waf`) and `customer/*` has 9 (incl. the same `access`, `assets`, `audit`, `reports`, `scope`, `settings`, `team`). The portal split landed without retiring the original tree.

13. **Dependency hygiene.**
    - `redis@^6.2.1` is in `dependencies` with **zero** imports — the app uses `ioredis` (`src/lib/redis.ts`).
    - `prisma` (the CLI) sits in `dependencies`, not `devDependencies` — that is what pulls the `mysql2` high-sev advisory into the production audit.
    - `js-yaml` 4.3.2 → 5.4.1, `typescript` 5.9.3 → 7.0.2, `eslint` 9 → 10, `vitest` 4 → 5 available (majors, no action implied).

14. **Clerk leftovers** (project uses Keycloak): `Organization.clerkId String? @unique` still on the live Prisma schema; `img.clerk.com` still in `next.config.ts` `images.remotePatterns`; `WafConfig` and `SiemAlert` models remain in the schema.

15. **Disk / Docker.** `portal/var/` = 159 MB orphaned build output. Docker: **64.71 GB build cache (22.56 GB reclaimable)**, 63.86 GB images (41.98 GB reclaimable), 345 MB containers (334 MB reclaimable). Host `/` at 67% (601 G free).

16. **Inconsistent file permissions.** 49 source files are mode `600` (owner-only) while neighbours are `664` — e.g. `src/lib/secret-bootstrap.ts`, `src/lib/auth/session-cookie.ts`, `src/lib/scope/authorization.ts`, all scope/auth/dispute API routes. Will bite any build or CI step running as a different user.

17. **Scheduled work isn't scheduled.** No user crontab, no systemd timer. `make refresh-greenbone` exists but nothing invokes it — the Greenbone cache is **7 days old** (rebuilt 2026-09-05, 236 MB).

18. **Services down.** `asv-keycloak-keycloak-1` exited 38h ago, `ds-asv-pg` was exited 38h ago (started during this diagnostic), `asv-scanner-it-postgres-1` exited 34h ago.

---

## State changed by this diagnostic
- `docker start ds-asv-pg` — portal test DB brought up so the suite could be measured honestly. Still running. Stop with `docker stop ds-asv-pg`.
- No files in the repo were modified. No branches, worktrees, or commits touched. `make lint` was deliberately **not** run (it writes via black/isort) — `--check` variants were used instead.

## Suggested order if you want to act
1. Persist the two dirty Codex worktrees (#3) — the only items that can lose work.
2. Bump `next` to 16.3.5 (#1).
3. Decide the merge order for main ← customer-portal (#2) and push.
4. Add `var/**` to eslint ignores + .gitignore, then fix the 20 real source errors (#5, #6).
5. Add a portal DB compose file + a single CI workflow running both suites (#4, #8).
6. Refresh AGENTS.md (#9).
