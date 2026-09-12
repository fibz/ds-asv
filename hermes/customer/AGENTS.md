# ds-asv — customer track (hermes/customer)

Everything in this directory is **ds-asv**. Nothing here references any other project.

## Where this sits

```
~/projects/ds-asv/                  # the ds-asv repo
├── portal/                         # Next.js/TS portal
├── scanner/                        # Python/FastAPI scanner
└── hermes/                         # Hermes work area (docs, arch, tracks)
    ├── arch/                       # infra inventory + network diagram
    ├── customer/                   # ← this directory
    └── scanner/                    # scanner track
```

- **Repo:** https://github.com/fibz/ds-asv — public
- **Branch:** `customer-portal` (working line); `main` is the release line
- **Desktop project anchor:** "DS-ASV Customer" → `~/projects/ds-asv/hermes/customer`

## Working rules (carried from the repo-level `AGENTS.md`)

- **Never report state from memory, cache, or earlier in the session.** Git status, test
  counts, push state, "clean" — re-run the check at that moment.
- **Check the actual error/output before responding.** No menus of guesses.
- **Shorter, plainer answers.** No walls of text, no status-table spam.
- **Make the calls that are the agent's to make.** Ask only when only the user can answer.
- The user makes spelling errors — read for intent, never nitpick.

Durable facts (repo URL, DB roles/ports, next phase, follow-ups, backup paths) live in the
repo-level `AGENTS.md`. **Read that file** when you need them — don't recall them.

## Git

- Repo-local credential helper: `git config credential.helper "!gh auth git-credential"`
- **Verify every push on the remote**, not just locally:
  `gh api repos/fibz/ds-asv/commits/<branch> --jq .sha`
- **The secret scanner blocks pushes.** It flags fake-looking examples (`sk_live_*`,
  `postgresql://user:pass@`, `PASSWORD 'x'` in migrations). Sanitize **in history**
  (`git filter-branch`) — a tip-only fix does not clear it.
- Read the **full** push error before guessing: `git push > /tmp/push.txt 2>&1; cat /tmp/push.txt`
  — it names the exact commit, path and secret type.

## Subprojects

- **`portal/`** — Next.js/TypeScript, Keycloak OIDC, PostgreSQL with RLS (app connects as
  `asv_app`, fail-closed). Tests: `npx vitest run` from `portal/`. `pnpm` is broken in this
  sandbox — use `npm`/`npx`.
- **`scanner/`** — Python/FastAPI scanner; CVE data through the `CVESource` seam
  (`GreenboneSource` cache reader). Tests: `make test` from `scanner/` (re-scan the current
  count, don't trust a remembered one).

## Hosts and infrastructure

- Inventory (user-confirmed hosts, roles, segments, OPEN items): `hermes/arch/infra-inventory.md`
- Diagrams: `hermes/arch/network-diagram.md` (+ `.html`)
- **Known defect:** `scanner/greenbone.env` points at **blue**; the live Greenbone CVE source
  is **purple**. Re-point before trusting that config.
- **Deployment is a manual AI-assisted push** heaven → purple. There is no CI.
- **Where the production stack actually lives** (verified 2026-09-12, read-only on purple):
  `purple:/home/cchock/projects/ds-asv-portal/` — a plain directory, **not a git repo**. It holds
  `deploy/vps/compose.yml`, `deploy/vps/nginx.conf`, `deploy/vps/certs/`, `deploy/vps/realm.json`.
  Nothing there is in this repo, and nothing there has history. **Version it before editing it.**
- **The edge is nginx**, not Caddy: container `ds-asv-portal-proxy-1` (`nginx:1.27-alpine`),
  published on `8443`, routing `/auth/` → `keycloak:8080` and everything else → `portal:3000`.
  A `Caddyfile` sits in the same directory but is unused — editing it does nothing.
- **An Azure load balancer fronts `purple:8443`** — the public address of the product is the load
  balancer, not purple. Its hostname must be a valid redirect URI on the Keycloak client (the portal
  derives the OAuth callback from the request origin), and it must forward `Host` + `X-Forwarded-Proto`.

## This directory

Empty apart from `.gitkeep` — a place for the customer track's own working material.
Keep additions inside the ds-asv scope and the rules above.
