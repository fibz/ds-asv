# customer-ui

The ds-asv **customer-facing frontend** — a standalone React + Vite + TypeScript SPA
(Tailwind v4) that gives a merchant a calm, guided view of their PCI ASV scan cycle:
Home, Assets, Scope, Scans, Reports, Report detail, and a sign-in landing.

It is **not** part of the Next.js `portal/`. It is built on its own and served as static
files, but it is **not a separate origin**: it runs under the base path `/app/` on the same
origin as the portal so the portal's existing Keycloak session authenticates its API calls.

Design and decisions live in
[`../hermes/customer/specs/2026-09-12-customer-ui-design.md`](../hermes/customer/specs/2026-09-12-customer-ui-design.md).
Production deployment is in
[`../hermes/customer/specs/2026-09-12-app-deployment.md`](../hermes/customer/specs/2026-09-12-app-deployment.md).

## How it authenticates

- The app calls the portal's API with **relative** paths (`/api/v1/…`) and
  `credentials: "include"`, so the browser attaches the portal's httpOnly `asv_session`
  cookie.
- Sign-in hands off to the portal's existing route (`/api/auth/login`), which runs the
  Keycloak authorization-code flow and sets the cookie; sign-out POSTs to
  `/api/auth/logout` (POST only — the portal redirects, it does not return JSON).
- There is **no second Keycloak client, no public client, no PKCE in the SPA, and no CORS
  surface** — because `/app/` and `/api/*` share one origin. The auth module
  (`src/lib/auth/auth.ts`) is the only place that knows this.

## Run it locally

```bash
cd customer-ui
npm install
npm run dev
```

Then open **http://localhost:5173/app/** — the app lives under `/app/`, not `/`.

In dev, Vite proxies `/api` to the portal on **`http://127.0.0.1:3000`** (see
`vite.config.ts`). So **the portal must be running** for the app to read real data:

```bash
cd ../portal && npm run dev     # serves the portal + its /api on 127.0.0.1:3000
```

Without the portal, pages render their real error/empty states — nothing is faked.

## Test and build

```bash
cd customer-ui
npm test         # vitest run — the unit/component suite
npm run build    # tsc -b && vite build → dist/
npm run lint     # oxlint
```

`npm run build` emits `dist/` with asset URLs already prefixed `/app/` (e.g.
`/app/assets/index-*.js`), which is what the reverse proxy serves. `dist/` is gitignored.

## Gotchas (the non-obvious ones)

- **Dev goes through the Vite proxy, not an absolute API URL.** The session cookie is
  host-scoped and ports are _not_ part of an origin, so `http://localhost:5173` and
  `http://localhost:3000` are different origins to the browser: a direct cross-port fetch
  is cross-origin and blocked by CORS before the httpOnly cookie is ever considered. The
  `/api` proxy makes the request same-origin, which is the whole point. Do **not** replace
  it with `http://localhost:3000` in code.
- **`tsc -b` typechecks the tests too.** `tsconfig.json` is a solution file that references
  `tsconfig.app.json`, `tsconfig.node.json`, and **`tsconfig.test.json`**, so a type error
  in any `*.test.ts(x)` fails `npm run build` — not just `npm test`. Keep test types honest.
- **Colour lives only in tokens and tone classes.** The only file allowed to contain a
  colour literal is `src/styles/tokens.css`; state colours are applied through the
  `.tone-*` classes in `src/styles/app.css`. Nothing under `src/components/` or
  `src/screens/` may contain `#rrggbb` / `rgb(` / `hsl(` — a test enforces this, and
  `src/lib/status.ts` is the single source of state → tone/glyph/label.
