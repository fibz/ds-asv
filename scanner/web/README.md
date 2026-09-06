# ASV Scanner Dashboard

Operator + QSA web dashboard for the ASV Scanner module (ds-asv Module 1).
React + Vite + TypeScript, consuming the existing FastAPI API in
`scanner/app/` (see `docs/superpowers/specs/2026-09-06-asv-scanner-dashboard-design.md`
for the full spec; plan: `docs/superpowers/plans/2026-09-06-asv-scanner-dashboard-plan.md`).

## Stack

- Vite + React + TypeScript
- TanStack Query (server state / polling)
- React Router
- Zustand (auth/session state)
- Tailwind CSS utility classes + `src/tokens.css` (palette, type, focus ring)
- No component library, no chart library (histogram is hand-rolled SVG)

## Dev

```bash
npm install          # node >= 20, npm 10.x (pnpm is broken on the VM)
npm run dev          # http://localhost:5173 — proxies /v1 and /portal to :8000
```

The FastAPI scanner API must be running on `localhost:8000` for live data.
Login uses the scanner bearer token (Phase 2+); `GET /v1/me` returns the role.

## Build

```bash
npm run build        # outputs to dist/ (tsc -b && vite build)
npm run test         # vitest (unit + component)
```

Production: Vite outputs to `dist/`; FastAPI is expected to mount that
directory as static assets (deployment follow-up). Google Fonts are loaded in
dev; self-host before production.

## Layout

```
/login                  Login
/                       Watch (operator) or Scans (QSA)
/scans                  Scans list
/scans/:id              Scan detail
/customers              Customers list (operator)
/customers/:id          Customer detail (operator)
*                       NotFound
```
