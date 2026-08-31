# 00 — Welcome to ds-asv

> **Who this is for:** junior engineers joining this project. Read 00 → 04 in order the first time; after that, use the chapters as reference. Nothing here assumes you already know PCI DSS, ASV, or multi-tenant security.

## What this project is

**ds-asv** is a commercial **PCI DSS compliance portal**. Merchants who must prove they scan their internet-facing systems (that's what PCI DSS Requirement 11.2 demands) use it to:

1. Add the systems they own (**assets**) — IPs, CIDRs, domains
2. Prove ownership (**verification**)
3. Run an **ASV scan** (Approved Scanning Vendor — a black-box security scan of those systems)
4. Get a **scan report** in the standard Qualys-style format, QA-attested before it's final

The product is **multi-tenant SaaS**: one deployment serves many customer organizations (tenants). Some tenants are **QSA resellers** (security consultancies) whose customer merchants are *child* organizations. Tenants must never see each other's data — that isolation is enforced at the **database level**, not just in app code.

## The two services

```
ds-asv/
├── portal/    # Control plane — Next.js 16 + TypeScript + PostgreSQL (RLS)
│              #   auth, orgs, teams, assets, scans, reports, the UI, the API
├── scanner/   # Scanner service — Python 3.13 + FastAPI + Celery
│              #   runs the actual black-box scans (nmap/testssl), scores findings
│              #   against a CVE database, produces evidence
├── docs/
│   ├── superpowers/specs/    # the design doc (the source of truth)
│   ├── superpowers/plans/    # implementation plans (phase by phase)
│   └── compendium/           # this guide
```

The two services share one PostgreSQL database. The control plane **never scans**; it issues a signed, short-lived **manifest** describing what to scan, and the scanner does the work and writes findings back.

## What's already built

| Area | Status |
|---|---|
| Tenant & identity (orgs, memberships, roles, invites, audit) | ✅ Phase 1 |
| Asset inventory (assets, verification, CSV import, dedupe, retire) | ✅ Phase 2 |
| User center hub (org profile, team, sessions/access, audit UI) | ✅ (merged) |
| Scans & scan reports (models, manifest, findings, report, QA gate) | 📋 planned — Phase 3 plan exists, not yet built |

## Getting started (10 minutes)

**Prerequisites:** Node ≥ 20.9, Docker, a Postgres on port **5433** (the test DB is a docker container named `ds-asv-pg`), Python 3.13 for scanner work.

```bash
# 1. Clone and install the portal
git clone https://github.com/fibz/ds-asv.git
cd ds-asv/portal

# pnpm is broken in this sandbox — always use npm/npx with the cache flag
npm install --cache /home/cchock/projects/.npm-cache

# 2. Environment (gitignored — copy the template and fill real passwords)
cp .env.example .env
#    DATABASE_URL=postgresql://asv_app:<pw>@localhost:5433/asv_portal
#    ADMIN_DATABASE_URL=postgresql://asv:<pw>@localhost:5433/asv_portal
#    APP_MODE=dev
#    KEYCLOAK_ISSUER / KEYCLOAK_CLIENT_ID / KEYCLOAK_CLIENT_SECRET

# 3. Generate the Prisma client (gitignored — needed after every clone/schema change)
npx --cache /home/cchock/projects/.npm-cache prisma generate

# 4. Run the tests — this is your health check
npx --cache /home/cchock/projects/.npm-cache vitest run
#   Expected: 32 files, ~228+ tests, all green
```

If the tests pass, your environment is correct. **Never proceed past a red suite** — a failing baseline makes every later failure ambiguous.

## The one rule that matters most

**The app connects to the database as `asv_app`** — a non-superuser role that is *always* subject to row-level security (RLS). Every tenant query must run inside a transaction that has set the tenant context (see [01 — Architecture](#01--architecture) and [02 — Conventions](#02--conventions)). If you ever find yourself tempted to connect as the `asv` superuser from app code, stop — that bypasses RLS and is how tenant isolation breaks.

## Where to look when you're stuck

| Problem | Look at |
|---|---|
| "What is this product supposed to do?" | `docs/superpowers/specs/2026-08-29-ds-asv-pci-portal-design.md` |
| "What phase are we on?" | `AGENTS.md` (top section — kept current) |
| "What are the working agreements?" | `AGENTS.md` (the rules we all follow) |
| "How do I add a feature the right way?" | `docs/compendium/02-conventions.md` |
| "How do I run/verify things day to day?" | `docs/compendium/03-workflows.md` |
| "What does this term mean?" | `docs/compendium/04-glossary.md` |

## Your first task, roughly

When you pick up a task, it usually comes from a plan in `docs/superpowers/plans/`. Plans are written so an engineer with zero project context can execute a single task: read the task brief, follow its TDD steps (failing test → implement → passing test → commit), and report. Chapter 03 walks through the whole loop.
