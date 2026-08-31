# 03 — Workflows

Day-to-day mechanics: how we run things, how we execute plans, and the traps that have already cost us time.

## Environment quick reference

| Thing | Value |
|---|---|
| Test DB | docker `ds-asv-pg` on port **5433**, database `asv_portal` |
| App connection | `DATABASE_URL` → `asv_app` (RLS-subject) |
| Admin connection | `ADMIN_DATABASE_URL` → `asv` (migrations, test seeding/cleanup) |
| Shadow DB (for `migrate diff`) | `asv_shadow` on :5433 (throwaway, wired via `prisma.config.ts`) |
| Package manager | **npm/npx only** — pnpm is broken in this sandbox |
| npm cache | `--cache /home/cchock/projects/.npm-cache` (default cache is read-only here) |

## Running tests

```bash
cd portal
npx --cache /home/cchock/projects/.npm-cache vitest run          # whole suite
npx --cache /home/cchock/projects/.npm-cache vitest run src/lib/org/team.test.ts   # one file
```

- **Green suite before you start, green suite before you commit.** Never claim "it passes" from memory — run it.
- Tests hit the real database and run **in parallel** (vitest workers). That's why test files use unique fixed ids and scoped wipes — never global DELETEs.

## The Prisma 7 workflow

`migrate dev` is unreliable in Prisma 7. The supported loop:

```bash
cd portal
# 1. Change schema.prisma
# 2. Generate the migration SQL (diffs live admin DB → schema, via shadow DB)
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > /tmp/m.sql
mkdir -p prisma/migrations/<timestamp>_<name>
cp /tmp/m.sql prisma/migrations/<timestamp>_<name>/migration.sql
# 3. Append RLS + GRANTs (see 02 — the fail-closed pattern)
# 4. Check Asset_active_unique survived the diff; re-append if dropped
# 5. Apply + regenerate
npx prisma migrate deploy
npx prisma generate
```

The generated Prisma client is **gitignored** — after a fresh clone, run `npx prisma generate` before tests.

## Executing a plan (the subagent-driven loop)

Plans in `docs/superpowers/plans/` are executed task-by-task with a fresh implementer subagent per task, a review after each, and a whole-branch review at the end. The state of a plan lives in a **ledger** (`.superpowers/sdd/<plan>/progress.md`):

- Task briefs are extracted per task (`task-N-brief.md`) — that brief is the implementer's requirements
- Implementer → report → reviewer (spec compliance + quality) → fix rounds if needed
- Rulings (decisions the controller made where the plan was ambiguous or wrong) are recorded in the ledger — **read the ledger before resuming any plan work**
- After all tasks: one final whole-branch review, one fix wave, one re-review
- The ledger is the recovery map. Trust it and `git log` over your memory.

If you're executing a single task: read your brief, follow its TDD steps verbatim, run the focused test then the full suite, commit, report. Don't improvise the plan's code — the brief is the contract.

## Working on a feature (git worktrees)

Feature work happens in an isolated worktree, never directly on `main`:

```bash
cd /home/cchock/projects/ds-asv
git worktree add .worktrees/<feature> -b <feature-branch>
# ... work, test, commit inside .worktrees/<feature> ...
# finish per repo convention: merge to local main, user approves the push
cd /home/cchock/projects/ds-asv
git merge <feature-branch>
# verify tests on merged main, push, then clean up:
git worktree remove .worktrees/<feature>
git branch -d <feature-branch>
```

`.worktrees/` is gitignored — that's deliberate.

## Pushing to GitHub — the gotchas that have cost us

1. **GitHub's secret scanner blocks pushes.** It flags things like `sk_live_*` placeholders, `postgresql://user:pass@` URLs (even localhost), and `PASSWORD 'x'` in migration SQL. Fakes are still flagged. Sanitize to `CHANGE_ME` **in history** (`git filter-branch`) — fixing just the tip commit does NOT clear it.
2. **Check the full push error first:**
   ```bash
   git push > /tmp/push.txt 2>&1; cat /tmp/push.txt
   ```
   The error names the exact commit/path/secret type. Read that before guessing.
3. The credential helper is per-repo: `git config credential.helper "!gh auth git-credential"`.
4. If main has no upstream yet: `git push --set-upstream origin main`.

## Sanity checklist before you claim anything done

- [ ] Full suite green, run just now (not "yesterday", not "earlier")
- [ ] `git status` clean (or only what you intend)
- [ ] Migration file contains the RLS + grants in the SAME file as the table
- [ ] `Asset_active_unique` survived any diff you ran
- [ ] `organizationId` never read from client input in your new code
- [ ] No raw secrets/tokens in code, logs, or committed files
- [ ] Audit event recorded for state changes you made
- [ ] No global `DELETE FROM` added to any test
- [ ] Push error read in full before reacting

## Known follow-ups (don't rebuild these)

- Cookie-session auth + Keycloak hosted-login UI (dashboard is header-auth only) — the `Session` registry is ready to bind cookie session ids
- Hardcoded dev DB passwords → env/Vault before any non-dev run
- Pre-existing tsc errors (next.config.ts duplicate output; normalize.ts BigInt target) — unrelated to feature work; don't "fix" them in a feature branch without a ruling
- Phase 3b: wire the real Python scanner to the manifest + findings contract
- Phase 4: versioned scope & authorization + dispute flow
