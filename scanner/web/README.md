# ASV Scanner Dashboard

Operator + QSA web dashboard for the ASV Scanner module (ds-asv Module 1).
React + Vite + TypeScript, consuming the existing FastAPI API in
`scanner/app/` (see `docs/superpowers/specs/2026-09-06-asv-scanner-dashboard-design.md`
for the full spec; plan: `docs/superpowers/plans/2026-09-06-asv-scanner-dashboard-plan.md`).

## Stack

- Vite + React + TypeScript (`strict`)
- TanStack Query (server state / polling)
- React Router
- Zustand (auth/session state, persisted to localStorage)
- Tailwind CSS utility classes + `src/tokens.css` (palette, type, focus ring)
- No component library, no chart library (histogram is hand-rolled SVG)

## Dev

```bash
npm install          # node >= 20, npm 10.x (pnpm is broken on the VM)
npm run dev          # http://localhost:5173 — proxies /v1 and /portal to :8000
```

The FastAPI scanner API must be running on `localhost:8000` for live data
(`uvicorn app.api.main:app` from `scanner/`, DB per the repo's `.env`).

Sign in with a scanner bearer token: `GET /v1/me` returns the role. The
shared operator token (`API_BEARER_TOKEN`, dev default `dev-token`) resolves
to `operator`; an `API_QSA_TOKEN` (+ `API_QSA_CUSTOMER_ID/NAME`) resolves to
a customer-scoped `qsa`. Both roles share this app; route guards and the
server together enforce who sees what.

## Roles & surfaces

| Route | Operator | QSA (own customer) |
|---|---|---|
| `/` (Watch: strip, histogram, feed) | ✓ | → `/scans` |
| `/scans` (filterable table) | ✓ | ✓ |
| `/scans/:id` (targets, findings, inspector, SAR) | ✓ | ✓ |
| `/customers`, `/customers/:id` | ✓ | — |

## Gates

```bash
npm run build        # tsc -b && vite build
npm run lint         # oxlint (the repo's lint gate; 0 errors/warnings required)
npm run test         # vitest run (unit + component, jsdom)
```

All three must pass before a merge. There is no E2E suite in v1 (spec §8
flags Playwright as the natural follow-up).

## Notes / follow-ups

- Production: Vite outputs to `dist/`; FastAPI is expected to mount that
  directory as static assets (deployment follow-up, spec §5.5). Google Fonts
  are loaded in dev; self-host before production.
- SARs download as files (spec open item: no in-app viewer). A plain `<a
  href>` would drop the bearer token, so `api/sar.ts` fetches with the
  Authorization header and hands the blob to the browser.
- "Create scan" on the Scans page routes operators to the dependency-free
  `/portal` flow (the dashboard does not duplicate onboarding/wizards, spec
  §7 out-of-scope).
- The activity feed derives events client-side from the scan list (the API
  has no transition log), matching the plan's "computed client-side".
