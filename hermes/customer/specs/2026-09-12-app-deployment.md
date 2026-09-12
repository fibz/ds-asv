# ds-asv customer-ui — production deployment runbook

**Date:** 2026-09-12
**Status:** Draft for review. **Documentation only — nothing in this file has been applied to
any host.**
**Scope:** how the new `customer-ui/` SPA is served at `/app/` on the production portal
origin, what the load balancer in front of it must do, and how to roll the change back.
**Author:** Hermes session with cchock

> **This runbook does not authorise an automated deploy.** There is **no CI**. Deployment to
> production is a **manual, human-run push** (coding on `heaven` → push to `purple`), and the
> steps below are written for a human to execute and watch. Do not wire this into an
> automated pipeline without a separate decision.

---

## 1. Topology (verified read-only on the host, 2026-09-12)

Production portal stack runs on host **`purple` (`74.156.0.13`, Azure VPS)** as **docker
compose**, project directory **`/home/cchock/projects/ds-asv-portal/deploy/vps/`**.

| Fact | Value | How known |
|---|---|---|
| Host | `purple` = `74.156.0.13` | read-only inspection 2026-09-12 |
| Stack | docker compose, project dir `/home/cchock/projects/ds-asv-portal/deploy/vps/` | read-only inspection 2026-09-12 |
| **That dir is NOT a git repository** | plain directory; no history, no diffs | read-only inspection 2026-09-12 |
| Files there | `compose.yml`, `nginx.conf`, `Caddyfile` (**unused**), `certs/`, `realm.json`, `realm.template.json`, `render-realm.sh` | read-only inspection 2026-09-12 |
| Portal container | `ds-asv-portal-portal-1` — Next.js, internal `:3000` | read-only inspection 2026-09-12 |
| Edge container | `ds-asv-portal-proxy-1` — `nginx:1.27-alpine`, published `0.0.0.0:8443->8443` | read-only inspection 2026-09-12 |
| Keycloak | `ds-asv-portal-keycloak-1`, `ds-asv-portal-keycloak-db-1` | read-only inspection 2026-09-12 |
| Database | `ds-asv-portal-db-1` | read-only inspection 2026-09-12 |
| Live `nginx.conf` | listens `8443 ssl`; `location /auth/` → `keycloak:8080`; `location /` → `portal:3000` | read-only inspection 2026-09-12 |
| Consequence | `/api/*` already reaches the portal on the same origin (matched by `location /`) | read-only inspection 2026-09-12 |
| Public entry point | an **Azure load balancer** in front of `purple:8443`; `8443` is **not** the user-facing address | told by the user 2026-09-12 |

The `Caddyfile` in that directory sits unused — nginx is what is running. **Editing the
Caddyfile does nothing.**

### Why this can be so small a change

`customer-ui/` is built with `base: "/app/"`, and its API calls are relative (`/api/v1/…`)
with `credentials: "include"`. So the only jobs for the deployed origin are: serve the static
files at `/app/`, and keep `/api/*` on the **same origin** so the portal's `asv_session`
cookie authenticates the calls. `/api/*` already resolves to the portal via `location /`;
only `/app/` is new.

---

## 2. Prerequisite — version `deploy/vps/` before editing it

**Do this first. Do not skip it.**

`/home/cchock/projects/ds-asv-portal/deploy/vps/` is **not** under version control. If you edit
`nginx.conf` or `compose.yml` in place, there is **no diff and no rollback** — a typo takes the
production login down with no undo.

Before any edit, put the directory under version control (in this repo or a sibling repo —
either is fine, the point is history):

```bash
cd /home/cchock/projects/ds-asv-portal/deploy/vps
git init
printf '%s\n' 'certs/' '*.pem' '*.key' > .gitignore   # never commit keys/certs; adjust to taste
git add . && git commit -m "chore(vps): baseline production deploy config before /app change"
```

From then on every edit here is a commit you can `git checkout -- <file>` back. **The rollback
in §5 depends on this step having been done.** If for any reason it has not, take a timestamped
copy of both files first (`cp nginx.conf nginx.conf.bak.$(date +%F)`, same for `compose.yml`).

---

## 3. The `/app/` step — exact nginx and compose changes

Two edits, both on `purple`, then a reload. The snippets below are the intended content; the
**exact surrounding node names in the live files are unverified** (the files are on the host and
were not read) — see §7.

### 3.1 `nginx.conf` — serve the SPA at `/app/`

Add this to the **existing** `server { listen 8443 ssl; … }` block in
`/home/cchock/projects/ds-asv-portal/deploy/vps/nginx.conf`:

```nginx
# customer-ui: the built SPA, served from inside the proxy container.
# Longest-prefix match: `location /app/` wins over `location /` regardless of order.

# /app without the trailing slash -> /app/ so the base path always has its slash.
location = /app {
  return 301 /app/;
}

location /app/ {
  root /usr/share/nginx/html;            # dist is mounted at .../html/app (see 3.2)
  try_files $uri $uri/ /app/index.html;  # history fallback for client-side routes
}
```

Notes:

- The last `try_files` argument is a **URI**, so it re-enters location matching and is served
  by this same block. That is what makes deep links like `/app/reports` load instead of 404.
- `/api/*` and `/auth/*` keep their existing locations and are untouched.
- `root` (rather than `alias`) is used deliberately: the URL prefix `/app/` maps to the
  directory `app/` under the document root, so the built-in path join is exactly right and
  avoids the known `alias` + `try_files` pitfalls. The plan's `alias /srv/customer-ui/;` form is
  equivalent; if you use `alias`, keep the trailing slash and re-test every asset URL.

### 3.2 `compose.yml` — bind-mount the built SPA into the proxy container

Add a read-only bind mount of the built `customer-ui/dist` into `ds-asv-portal-proxy-1`
(compose service `proxy`), so nginx can serve it from the path used above:

```yaml
services:
  proxy:
    image: nginx:1.27-alpine
    volumes:
      # ...existing entries, e.g. the bind-mounted nginx.conf...
      # ADD: the built SPA, read-only, at the document-root subdir the location block uses
      - ./app-dist:/usr/share/nginx/html/app:ro
```

`./app-dist` is relative to the compose file's directory
(`/home/cchock/projects/ds-asv-portal/deploy/vps/app-dist`). The built `dist/` from
`customer-ui/` must be copied onto `purple` at that path **as part of the manual push** —
`customer-ui/dist` is not committed and does not live on `purple` today. Build on `heaven`
first:

```bash
cd /home/cchock/projects/ds-asv/customer-ui && npm run build
# then copy the artefact to purple, e.g.:
#   rsync -a --delete dist/ purple:/home/cchock/projects/ds-asv-portal/deploy/vps/app-dist/
```

### 3.3 Apply and reload

Adding a **new bind mount** changes the container's definition, so the container must be
**recreated**, not merely reloaded:

```bash
cd /home/cchock/projects/ds-asv-portal/deploy/vps
docker compose up -d proxy            # recreates ds-asv-portal-proxy-1 with the new mount
docker compose exec proxy nginx -t    # validate config before trusting it
```

For a **config-only** change after that (e.g. tuning the `location` block), a reload is enough:

```bash
docker compose exec proxy nginx -s reload
# equivalently: docker compose restart proxy
```

Never reload/restart the proxy without `nginx -t` passing first.

### 3.4 Confirm

```bash
# The SPA's assets and entry document are served:
curl -sk https://127.0.0.1:8443/app/ | head
curl -skI https://127.0.0.1:8443/app/assets/          # any asset path from dist/index.html
# Deep link falls back to index.html:
curl -sk https://127.0.0.1:8443/app/reports | head
# The portal is untouched:
curl -skI https://127.0.0.1:8443/
```

Expected: `/app/` returns the SPA HTML, asset URLs resolve, `/app/reports` returns the SPA
HTML (not 404), and `/` still returns the portal.

---

## 4. Load balancer (Azure) — required before `/app` is usable by a real user

The public entry point is the **load balancer in front of `purple:8443`**, not `8443` itself.
The portal derives its OAuth callback from the **request origin**, so the load balancer is not
decorative — the wrong configuration here breaks login, not just `/app`:

1. **Register the load balancer's hostname as a Keycloak redirect URI.** The portal derives the
   callback from the origin the browser used, so the redirect URI Keycloak sees depends on the
   LB hostname. It must be listed on the Keycloak client as an **exact match** — Keycloak rejects
   anything else, and an unlisted hostname is a hard failure at the callback. (Client is the
   portal's existing `asv-portal` client; no second client is created.)
2. **Forward the original `Host` and `X-Forwarded-Proto`.** nginx already forwards both to the
   portal; the load balancer must too, or the derived callback names the wrong host or scheme
   (`http` instead of `https`).
3. **Decide TLS termination: re-encrypt or passthrough.** TLS terminates **twice** (LB, then
   nginx on `8443`), so:
   - **Pass-through** → the browser sees the **nginx certificate**; it must be valid for the LB
     hostname (SNI) or users get certificate errors, and the LB must send
     `X-Forwarded-Proto: https` anyway.
   - **Re-encrypt** → the LB presents its own certificate and opens a second TLS session to
     nginx; the LB must be configured to trust/accept nginx's certificate, and nginx still
     records `X-Forwarded-Proto: https`.
   Either is fine; the point is it must be **decided and recorded**, not left to chance.
4. **Do not rewrite the path.** `/app/` and `/api/` must reach nginx unchanged, or same-origin
   breaks and the cookie stops matching.
5. **Health check** should target `purple:8443` (the exact path is an open question — §7).

The app itself needs no change for any of this: `/app` and `/api` are relative, so they follow
whatever hostname the user arrives on.

---

## 5. Rollback

Rollback is the reverse of §3 and is **safe to do at any moment**: the `/app` change is purely
additive — it routes a new URI prefix to a new read-only mount and touches no existing route.

1. **Restore the config from version control** (the §2 prerequisite is what makes this real):
   ```bash
   cd /home/cchock/projects/ds-asv-portal/deploy/vps
   git checkout -- nginx.conf compose.yml     # or: git revert <feat-commit>
   ```
   If the directory could not be versioned first, restore the timestamped `.bak` copies instead.
2. **Remove the mount by recreating the proxy** (removing a bind mount requires a recreate,
   not a reload):
   ```bash
   docker compose up -d proxy
   ```
   The bind mount is read-only and additive, so even if it were left in place it is harmless —
   removing the `location /app/` block is what actually stops the SPA being served.
3. **Validate and reload** if the change was config-only:
   ```bash
   docker compose exec proxy nginx -t && docker compose exec proxy nginx -s reload
   ```
4. **Confirm the portal still serves at `/`:**
   ```bash
   curl -skI https://127.0.0.1:8443/          # portal HTML, HTTP 200
   curl -skI https://127.0.0.1:8443/auth/     # Keycloak, servable
   ```
   Expected after rollback: `/` is the portal, login still works, and `/app/` now falls through
   to `location /` → the portal (a portal 404 or portal HTML — **expected**, since the SPA is no
   longer routed).

Nothing in `portal/` or `scanner/` is changed by this deployment, so rollback is entirely a
proxy-config operation.

---

## 6. Manual push

**Deployment is a manual, human-run push** (code on `heaven` → `purple`). **There is no CI**
(no `.github/workflows`, no hooks). This document describes the steps; it **does not authorise
automating them**. A human runs §2 (version control), §3 (build, copy `dist`, edit config,
recreate), and §4 (load balancer) and watches the result.

---

## 7. Verified vs assumed

Everything I could see directly is in the left column. Anything I could not personally verify is
in the right column and must not be treated as fact.

### Verified

| Fact | Evidence | Date |
|---|---|---|
| Topology and container/port table in §1 | read-only inspection of `purple` | 2026-09-12 |
| `deploy/vps/` is not a git repo; file list incl. unused `Caddyfile` | read-only inspection of `purple` | 2026-09-12 |
| Live nginx routes `/auth/`→keycloak, `/`→portal (so `/api/*` same origin) | read-only inspection of `purple` | 2026-09-12 |
| Azure LB fronts `purple:8443`; callback derived from request origin; LB must forward `Host` + `X-Forwarded-Proto` | told by the user | 2026-09-12 |
| `customer-ui` `base: "/app/"`; dev proxy `/api` → `127.0.0.1:3000` on port `5173` | `customer-ui/vite.config.ts` (this repo) | 2026-09-12 |
| `dist/index.html` asset URLs are `/app/assets/…` | built output + `grep` (this repo) | 2026-09-12 |
| `BrowserRouter basename="/app"` | `customer-ui/src/main.tsx` | 2026-09-12 |
| API is relative `/api/v1/…` with `credentials: "include"` | `customer-ui/src/lib/api/client.ts` | 2026-09-12 |
| Auth uses portal routes `/api/auth/login` and `/api/auth/logout` (POST only) | `customer-ui/src/lib/auth/auth.ts` | 2026-09-12 |
| Colour literals allowed only in `tokens.css`; `.tone-*` classes in `app.css` | source files + tests | 2026-09-12 |
| `tsc -b` includes `tsconfig.test.json`; build/test scripts | `customer-ui/package.json`, `tsconfig.json` | 2026-09-12 |
| `customer-ui/dist` is gitignored | root `.gitignore` | 2026-09-12 |

### Answered by a second read-only inspection (2026-09-12, after this runbook was first written)

The first draft listed eleven open questions. Nine are now settled from files rather than guesswork.

| # | Was | Now |
|---|---|---|
| 1 | Service name assumed `proxy` | **Confirmed.** `compose.yml` service is `proxy` (`nginx:1.27-alpine`), with `./nginx.conf:/etc/nginx/nginx.conf:ro` and `./certs:/etc/nginx/certs:ro`. Adding `./app-dist:/usr/share/nginx/html/app:ro` follows the existing pattern exactly. |
| 2 | Relative-mount base assumed | **Confirmed.** The compose project's working dir is `/home/cchock/projects/ds-asv-portal/deploy/vps`, so `./app-dist` lands there. |
| 3 | Is the bare-`/app` redirect wanted? | **Decision: yes.** `location /app/` does not match bare `/app`; without a redirect it falls through to the portal. Ship the 301. |
| 5 | Cookie scope unknown | **Confirmed, and it is fine.** `sessionCookieOptions()` in `portal/src/lib/auth/session-cookie.ts` sets `httpOnly`, `SameSite=Lax`, `Secure` when `APP_MODE=prod`, **`Path=/`**, 8h max-age, no `Domain`. So `/app` and `/api` share it on one origin. No portal change needed. |
| 8 | Callback path assumed | **Confirmed in the repo.** `login/route.ts` builds `redirectUri = `${origin}/api/auth/callback``. The LB's registered URI must equal that. |
| 10 | Portal dev port assumed | **Confirmed.** The `portal` service `expose: 3000`; Next.js dev also defaults to 3000, matching the Vite proxy target. |
| 11 | No other routing needed | **Confirmed.** The live nginx routes only `/auth/`, `/`, and (new) `/app/`. |
| 4 | LB hostname unknown | **Mechanism now known; only the value is missing.** The compose parameterises **`PUBLIC_HOST`** and requires it (`KEYCLOAK_ISSUER: https://${PUBLIC_HOST}/auth/realms/asv-portal`, `PUBLIC_ORIGIN: https://${PUBLIC_HOST}`). The realm is generated: `render-realm.sh` substitutes `__PUBLIC_HOST__` into `realm.template.json` (`redirectUris: ["https://__PUBLIC_HOST__/*"]`) to produce `realm.json`. **When the LB host exists: set `PUBLIC_HOST`, re-run `render-realm.sh`, restart keycloak.** Today `realm.json` holds `https://74.156.0.13:8443/*` — purple's raw address. |
| 7 | Artifact copy mechanism | **Decision:** `rsync -av --delete customer-ui/dist/ purple:…/deploy/vps/app-dist/`, run by hand as part of the manual push. `dist/` stays uncommitted. |

### Still genuinely open — these need a human answer

| # | Open question | Why it blocks |
|---|---|---|
| 4b | **The load balancer's hostname** (the value for `PUBLIC_HOST`). | Confirmed by the user on 2026-09-12: **the load balancer is not provisioned yet.** Blocked on Azure, not on this work. Nothing to do until it exists — then set `PUBLIC_HOST`, re-render the realm, restart Keycloak. |
| 6 | **TLS re-encrypt vs passthrough** at the LB. | Decides whose certificate a browser sees, and what the LB must trust. An Azure configuration choice. |
| 9 | Whether the portal's logout redirect to its own `/sign-in` is acceptable, or `/sign-in` should be aliased to `/app`. | Cosmetic but user-visible: signing out currently leaves the SPA. |

### New findings from the second inspection

| Finding | Why it matters |
|---|---|
| **Keycloak realm has `sslRequired: none`** while `APP_MODE=prod`. | Hardening gap: the realm will not itself require HTTPS. TLS is terminated in front, so it is not exposed today — but it should be `external` in production. |
| **Two compose files exist**: `/home/cchock/projects/ds-asv-portal/compose.yml` (top level, beside a `Caddyfile`) and `deploy/vps/compose.yml`. | Only the latter is live (confirmed by the running stack's working dir). Editing the wrong one silently does nothing. The top-level pair looks like an earlier iteration and should be deleted or clearly marked stale. |
| **The stack's environment lives in `/home/cchock/projects/ds-asv-portal/.env`** (mode 600), not in `deploy/vps/`. | `PUBLIC_HOST`, `DB_ADMIN_PASSWORD`, `APP_DB_PASSWORD`, `MANIFEST_SECRET` and the Keycloak vars are all required by compose and come from there. Whoever deploys needs that file present and correct. |
| **`/home/cchock/projects/ds-asv-portal/` is a copied tree, not a clone** — it contains `portal/`, `scanner/`, `docs/`, `AGENTS.md`. | Explains why it is not a git repository. It is also why the running portal's provenance is unclear: there is no commit to say which code is deployed. |

---

## 8. Related documents

- Design and decision log: `hermes/customer/specs/2026-09-12-customer-ui-design.md` (§7 auth/deploy topology)
- Implementation plan: `hermes/customer/plans/2026-09-12-customer-ui-implementation.md` (Task 16)
- App-level README (local run, build, gotchas): `customer-ui/README.md`
- Infra inventory / hosts: `hermes/arch/infra-inventory.md`

---

## 9. Deployed 2026-09-12 — what was actually done

The `/app` deployment was carried out and verified. This section is the record, so the next person can see exactly what changed and how to undo it.

### What changed on purple

| # | Change | Detail |
|---|---|---|
| 1 | Full backup taken first | `~/backups/ds-asv-portal-20260912-2356.tar.gz` (613K) — whole `ds-asv-portal/`, excluding `node_modules`, `.next`, `.git`, `dist` |
| 2 | Two portal source files replaced | `portal/src/app/api/v1/reports/route.ts` (new) and `portal/src/lib/scope/service.ts` (sha256 `234773f2…` verified identical to the repo after copy). Nothing else in `portal/` was touched — **not** a tree sync |
| 3 | Portal image rebuilt and restarted | `docker compose --env-file ../.env build portal` then `up -d portal`. Container logged "No pending migrations to apply". The previous image id is recorded below for rollback |
| 4 | SPA artifact copied to the host | `rsync --delete customer-ui/dist/ …/deploy/vps/app-dist/` |
| 5 | `nginx.conf` — `/app` block added | `location = /app` 301; `location = /app/index.html` with `no-store`; `location /app/` with `try_files $uri $uri/ /app/index.html`. Backup: `nginx.conf.bak-20260912` |
| 6 | `compose.yml` — mount added | `./app-dist:/usr/share/nginx/html/app:ro` under the `proxy` service. Backup: `compose.yml.bak-20260912` |
| 7 | **`nginx.conf` — `mime.types` included** | See the finding below; backup `nginx.conf.bak-mime`. Applied with `nginx -s reload` (no restart, no downtime) |

### The finding that mattered most

After the `/app` block was in place every check returned **200** — and the app was still broken. `curl` reported:

```
/app/assets/index-*.js -> 200 text/plain
```

The custom `nginx.conf` never included `/etc/nginx/mime.types`, so nginx had no type map and labelled everything `text/plain`. A browser refuses to execute `<script type="module">` served with a non-JavaScript MIME type, so the page would have rendered blank while every shell-level check passed. Fixed by adding `include /etc/nginx/mime.types;` and `default_type application/octet-stream;` to the `http` block. Verified afterwards: JS `application/javascript`, CSS `text/css`, HTML `text/html`, SVG `image/svg+xml`.

**Lesson worth keeping:** a 200 from `curl` does not prove a frontend works. The only check that caught this was loading the page in a real browser.

### Verified after deploy (from `purple` itself, and from `heaven` over the public address)

| Check | Result |
|---|---|
| `/app/` | 200 `text/html` |
| `/app` (bare) | 301 → `/app/` |
| `/app/reports` (client deep link) | 200, serves `index.html` |
| `/app/assets/*.js` / `*.css` | 200 `application/javascript` / `text/css` |
| `/api/v1/reports` | 401 (route now exists — it was 404 before the portal rebuild) |
| `/api/v1/org` | 401 |
| `/` (portal) | 200 `text/html` unchanged |
| `/auth/realms/asv-portal` (Keycloak) | 200 unchanged |
| **Real browser at `https://74.156.0.13:8443/app/sign-in`** | renders the sign-in landing, CTA href `/api/auth/login`, no password field, **zero console errors, zero page errors, zero failed requests** |

### Rollback

1. **Proxy/config only:** restore `nginx.conf.bak-20260912` (or `.bak-mime`), `compose.yml.bak-20260912`, then `docker compose --env-file ../.env up -d proxy`. The SPA simply stops being served; the portal is unaffected either way.
2. **Portal image:** the previous image id is `sha256:c92371bb99bbbba9bdea2636879d11a8ff2981ce4b6b128ac61da0bb678d6cb3`. Re-tag it as `ds-asv-portal-portal` and `up -d portal`.
3. **Source:** extract `~/backups/ds-asv-portal-20260912-2356.tar.gz` over `/home/cchock/projects/`.

### Still not done

- **The authenticated path has never been exercised on purple.** The no-backend half is verified in a browser; signing in requires real user credentials, which this session did not handle. Someone should click through sign-in → home → scope → reports once.
- **The portal source on purple is still a copy, not a checkout.** The image now contains the two files above, but nothing records which revision the rest of it came from. `deploy/vps/` remains unversioned as well.
- The load balancer is not provisioned, so the realm still lists `https://74.156.0.13:8443/*`.
