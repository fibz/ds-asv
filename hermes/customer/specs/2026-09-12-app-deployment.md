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

## 9. Authenticated walkthrough — 2026-09-12 (real browser, live)

Performed in a real Chromium against `https://74.156.0.13:8443/app/`, signed in through the actual Keycloak form. This is the first time this app has ever held an authenticated session.

### What works

| Check | Result |
|---|---|
| Sign-in | `admin@asv.test` authenticated against the live realm |
| Session cookie accepted by the SPA | yes — `/app/` renders the app, not the sign-in landing |
| `GET /api/v1/org` | **200** |
| `GET /api/v1/assets` | **200** |
| `GET /api/v1/scope-sets` | **200** |
| `GET /api/v1/scans` | **200** |
| `GET /api/v1/reports` | **200** — the route that only exists because of the portal rebuild in §10 |
| Console / page / failed-request errors | **none** |
| Real data rendered | org `ATHENA-DFENZ PRIVATE LIMITED`; "Q3 2026 · PCI ASV scan window **18 days left**" (matches the unit test) |
| Empty states | checklist `0 of 5 done`, locked steps each with a reason, `ASSETS 0` |

### Defect found — signing in from `/app` lands in the OLD UI

`portal/src/app/api/auth/callback/route.ts:56` redirects to:

```ts
const res = NextResponse.redirect(`${origin}/dashboard`);
```

**`/dashboard` is not a route in either tree.** Live: `GET /dashboard` → `307` → `/sign-in` → (authenticated) → `/customer`. So a user who starts at `/app/sign-in`, signs in, and expects to arrive in the new UI is dumped into the old one. The new UI cannot complete its own login journey.

**Proposed fix (not yet made):** carry a return target through the OAuth round trip.

1. `customer-ui` `signInUrl()` appends `?returnTo=/app/`;
2. `portal/src/app/api/auth/login/route.ts` stores it in a short-lived cookie (it currently reads no query params);
3. the callback redirects to the stored value, **validated as a local path** (`startsWith("/") && !startsWith("//")`) so it cannot become an open redirect;
4. absent a `returnTo`, behaviour is unchanged — the old UI keeps working.

### Other findings from this session

- **The realm has exactly three users**: `admin` (admin@asv.test, `asv-staff`), `regular-user` (user@asv.test, no roles), `staff-user` (staff@asv.test, `asv-staff`). `deploy/vps/realm.json` is **stale** — it lists only the latter two and omits `admin`, which is the only account with an organisation.
- **`admin@asv.test`'s password is not stored anywhere on the host.** Direct-grant checks: `staff-user`/`STAFF_PASSWORD` ✅, `regular-user`/`REGULAR_PASSWORD` ✅, `admin` with either ❌ 401. Without that password no automated login into the populated org is possible.
- **A never-invited Keycloak user gets no organisation.** `provisionUserFromClaims` (`portal/src/lib/auth/keycloak.ts:110`) inserts `{ idpId, email }` with **no `orgId`**, so a fresh login has no tenant and sees nothing. Org membership comes from the invitation flow, not from authenticating.
- **The org itself is empty** — 0 assets, 0 scans, 0 reports (two scope sets created 2026-09-12 are the only activity). So the empty states above are correct behaviour, and this walkthrough could not exercise populated lists.
- **Operational note for automated logins:** the vault prompt for this origin re-fills the most recently saved entry (identifier *and* password). Several attempts failed identically before that was noticed; the username had to be typed into the field directly.

---

## 10. Deployed 2026-09-12 — what was actually done

The `/app` deployment was carried out and verified. This section is the record, so the next person can see exactly what changed and how to undo it.

### What changed on purple

| # | Change | Detail |
|---|---|---|
| 1 | Full backup taken first | `~/backups/ds-asv-portal-20260912-2356.tar.gz` (613K) — whole `ds-asv-portal/`, excluding `node_modules`, `.next`, `.git`, `dist` |
| 2 | Two portal source files replaced | `portal/src/app/api/v1/reports/route.ts` (new) and `portal/src/lib/scope/service.ts` (sha256 `234773f2…` verified identical to the repo after copy). Nothing else in `portal/` was touched — **not** a tree sync |
| 3 | Portal image rebuilt and restarted | `cd deploy/vps && sudo docker compose --env-file /home/cchock/projects/ds-asv-portal/.env build portal` then `up -d portal`. Container logged "No pending migrations to apply". The previous image id is recorded below for rollback |
| 4 | SPA artifact copied to the host | `rsync --delete customer-ui/dist/ …/deploy/vps/app-dist/` |
| 5 | `nginx.conf` — `/app` block added | `location = /app` 301; `location = /app/index.html` with `no-store`; `location /app/` with `try_files $uri $uri/ /app/index.html`. Backup: `nginx.conf.bak-20260912` |
| 6 | `compose.yml` — mount added | `./app-dist:/usr/share/nginx/html/app:ro` under the `proxy` service. Backup: `compose.yml.bak-20260912` |
| 7 | **`nginx.conf` — `mime.types` included** | See the finding below; backup `nginx.conf.bak-mime`. Applied with `nginx -s reload` (no restart, no downtime) |

> **Gotcha — the env file is two levels up.** The stack was started with `--env-file /home/cchock/projects/ds-asv-portal/.env`. From `deploy/vps` that is `../../.env`, **not** `../.env` (which resolves to `deploy/.env` and makes compose abort with `couldn't find env file`). Always use the absolute path.
>
> A failed build here is harmless — compose aborts before touching the running container. That is exactly why the build and the `up` are run as separate steps.

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

> **Corrected 2026-09-12 (late): the old image ids are gone.** Rebuilding with the same tag leaves the previous image dangling, and nothing on purple retains those — `sha256:c92371bb…`, `sha256:6a7b7d49…` and `sha256:d44d4aa2…` are all absent from `docker images` now. **Do not plan a rollback around re-tagging an old image id.** Roll back from source instead.

1. **Proxy / config only:** restore whichever of `nginx.conf.bak-*` / `compose.yml.bak-20260912` you need, then `cd deploy/vps && sudo docker compose --env-file /home/cchock/projects/ds-asv-portal/.env up -d proxy`. The SPA simply stops being served; the portal is unaffected either way.
2. **Portal code — the intended path:** the deployed tree is a git repo (§11, baseline `55ad2f7`). `git -C /home/cchock/projects/ds-asv-portal diff` shows everything changed since the baseline, `git checkout -- <path>` reverts a file, then rebuild and `up -d portal`.
3. **Full source restore:** extract `~/backups/ds-asv-portal-20260912-2356.tar.gz` over `/home/cchock/projects/` (it pre-dates the SPA work; use only if the git baseline is unusable).
4. **SPA only:** `rsync` an earlier `customer-ui/dist/` into `deploy/vps/app-dist/` — no container action needed, the mount is live.

### Still not done

- **The authenticated path has never been exercised on purple.** The no-backend half is verified in a browser; signing in requires real user credentials, which this session did not handle. Someone should click through sign-in → home → scope → reports once.
- **The portal source on purple is still a copy, not a checkout.** The image now contains the two files above, but nothing records which revision the rest of it came from. `deploy/vps/` remains unversioned as well.
- The load balancer is not provisioned, so the realm still lists `https://74.156.0.13:8443/*`.

---

## 11. Incident: deploying the repo broke every login (2026-09-12)

### What happened

A deploy that copied the repo's `portal/src/lib/auth/{session-cookie.ts}` and `api/auth/{login,callback}/route.ts` over purple's versions **broke all logins**, for both the new UI and the old one (they share the login route).

`/api/auth/login` began sending Keycloak:

```
redirect_uri = https://0.0.0.0:3000/api/auth/callback
```

The realm only registers `https://74.156.0.13:8443/*`, so Keycloak refused with *Invalid parameter: redirect_uri* before the user could even type a password.

### Root cause

**The deployed tree carried three fixes that were never committed to this repo**, and the copy removed them:

| Fix | Deployed (was) | Repo (had) |
|---|---|---|
| `publicOrigin()` — browser-facing OAuth origin | `PUBLIC_ORIGIN ?? requestOrigin` | raw `request.nextUrl.origin` → `0.0.0.0:3000` |
| `internalIssuer()` — server-side code exchange | `KEYCLOAK_INTERNAL_ISSUER` (Docker network) | public URL, so Node had to trust the proxy's self-signed cert |
| `keycloakInternalIssuer()` — JWKS fetch | `KEYCLOAK_INTERNAL_ISSUER` | public URL, same certificate problem |

The reason is structural, not accidental: **`deploy/vps/` and the deployed `portal/` copy are not a git checkout.** Nothing records which revision is running, so the repo and production had silently drifted.

### The process failure

The first deploy of the evening diffed `scope/service.ts` against purple's copy **before** overwriting it, found it identical apart from the intended change, and generalised from that one file to "the rest of the auth files must match too". That generalisation was never tested. **Diff the pre-existing deployed content of every file you are about to overwrite** — one verified file proves nothing about the next.

### Blast radius and recovery

- Logins only. `/` and `/app/` returned 200 throughout; no data was touched.
- Recovery: the pre-deploy backup (`~/backups/ds-asv-portal-20260912-2356.tar.gz`) still held the originals. Restoring the three files and rebuilding put `/api/auth/login` back to `redirect_uri=https://74.156.0.13:8443/api/auth/callback`, and a browser sign-in succeeded.
- Staging build and `up` as separate steps is what made this a failed command rather than a half-applied change.

### Resolution

The three fixes are now **in the repo** (commit `d2a3fbad`), with the validated `returnTo` work layered on top, and tests pinning each one — including the internal-issuer JWKS in its own file, because the JWKS is cached per module instance. `PUBLIC_ORIGIN` and `KEYCLOAK_INTERNAL_ISSUER` are load-bearing production env vars, not optional.

### Standing risk

**The repo still cannot reproduce production.** An unknown amount of `portal/` on purple may differ from git. Before the next deploy, reconcile:

```sh
ssh purple 'cd /home/cchock/projects/ds-asv-portal/portal && find src -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 | sort -z | xargs -0 sha256sum'
# compare against the same command run in the repo
```

As of this incident that comparison showed parity except for files whose repo version was simply newer. It should be re-run before trusting a deploy.

**Partly addressed on 2026-09-12:** `/home/cchock/projects/ds-asv-portal/` is now a local git repo (baseline `55ad2f7`) with secrets gitignored, so production changes are diffable and revertible from here on. It has no remote, and it is still a separate tree from this repo — so **re-run the hash comparison before every deploy** rather than trusting that the two have converged.

---

## 12. Final state — end of 2026-09-12

### Deployed and verified

| Item | State |
|---|---|
| Portal image | rebuilt from the **reconciled** source (repo commit `d2a3fbad`) — `publicOrigin`, `internalIssuer`, `keycloakInternalIssuer` now in the repo, with validated `returnTo` on top. **Known-good running image: `sha256:560891f007fbb3d467eb050ae175b7c6ddf66851877fe8d181ed0352335c1e32`** (started 2026-09-12T16:46Z) |
| `redirect_uri` | `https://74.156.0.13:8443/api/auth/callback` ✅ |
| Sign-in from `/app` | **lands in `/app`** ✅ (was `<origin>/dashboard` → `/sign-in` → `/customer`) |
| Off-site `returnTo` | refused ✅ |
| SPA bundle | `customer-ui` at `deploy/vps/app-dist`, assets under `/app/static/` |
| Portal tests | 431 (428 passed, 3 live-Keycloak skipped), tsc clean |
| SPA tests | 189, tsc clean, lint clean |

### Bug found and fixed during the final walk: `/app/assets` returned 403

The SPA has a route at `/assets`, and the Vite build also emitted a directory `/app/assets/`. With `try_files $uri $uri/ /app/index.html`, a request for the *route* matched the *directory*, found no index and returned **403 Forbidden** — while client-side navigation to the same screen worked fine, which is exactly why it survived the earlier checks.

Two changes, belt and braces:

1. `customer-ui/vite.config.ts` — `build.assetsDir: "static"`, so no bundle directory can collide with a route name (assets now served from `/app/static/`).
2. `nginx.conf` — `try_files $uri /app/index.html;` (directory branch dropped; for an SPA only real files should match).

Verified after the fix: `/app/assets` → `200 text/html`, `/app/static/index-*.js` → `200 application/javascript`.

### Full authenticated screen walk (real browser, live session)

Every screen loaded with **zero console errors, zero page errors, zero failed requests**:

| Route | Result |
|---|---|
| `/app/` | checklist home, "0 of 5 done", real org name, 18 days left |
| `/app/assets` | "Everything that may be scanned…" + Add asset / Import CSV, empty state |
| `/app/scope` | "What is approved for scanning, and the version history behind it." |
| `/app/scans` | "Every scan this organisation has run, newest first." |
| `/app/reports` | "Each report records the scope version it was run against." |
| `/app/team`, `/app/access`, `/app/audit`, `/app/settings` | **by design** — "This screen is not built yet — it is scheduled for the second pass of the customer UI." |

The four placeholder screens are the intended second-pass scope, not defects. The org has no assets/scans/reports, so the empty states above are correct behaviour rather than an untested path.

### Still outstanding

1. **The load balancer — deferred, NOT a blocker.** Not provisioned, and the user confirmed on 2026-09-12 that **the app is not live yet**, so nothing here is on the critical path. When a real hostname exists, see the Keycloak note below for the correct cutover.
2. **The self-signed certificate** — browsers warn before `/app`. The LB should terminate real TLS.
3. **`deploy/vps/` and the deployed `portal/` — now baselined (was the root cause of §11).** As of 2026-09-12 the deployed tree at `/home/cchock/projects/ds-asv-portal/` is a **local git repo** (initial commit `55ad2f7`, 394 files) with a `.gitignore` that excludes `.env`, `certs/`, `*.pem`, `*.key`, `realm.json`, `app-dist/`, `node_modules/` and dumps — verified: no secrets staged, no private keys in the diff. Changes to production config are now diffable and revertible. **It has no remote**, so that history exists only on purple; and it is still not the same tree as this repo, so the pre-deploy hash comparison in §11 stays mandatory.
4. **Second-pass screens** (team, access, audit, settings) and the **dispute/authorisation flows are built** in the SPA, but the four management screens are placeholders.
5. **`admin@asv.test`'s password is not on the host** — automated end-to-end login depends on it being known.

---

### Changing the Keycloak realm: two traps

The Keycloak service runs `start --import-realm` with the realm bind-mounted from `deploy/vps/realm.json`, but **the realm lives in the `keycloak-data` volume**, so:

1. **`--import-realm` only imports a realm that does NOT already exist.** The realm is already in the database. Re-running `render-realm.sh` and restarting Keycloak is a **silent no-op** — the stored realm wins. Do not expect a restart to apply a realm.json change.
2. **NEVER wipe `keycloak-data` or delete the realm to force a re-import.** `realm.template.json` contains only `staff-user` and `regular-user`. The `admin` user — the one that actually owns the organisation and holds data — was created *after* the original import and is **not in the template**. Resetting the realm deletes that account and locks you out of the only populated tenant.

**Correct method for any realm change:** update the running realm through the admin API (or console) — e.g. `PUT /auth/admin/realms/asv-portal` with the amended `redirectUris`/`webOrigins` — and treat `realm.json` as documentation of the initial state, not as the live configuration.

**Load-balancer cutover, when a hostname exists:** add `https://<lb-host>/*` to the realm's `redirectUris` + `webOrigins` (admin API), set `PUBLIC_HOST=<lb-host>` in purple's `.env` (it drives `KC_HOSTNAME`), set the portal's `KEYCLOAK_ISSUER` + `PUBLIC_ORIGIN` to `https://<lb-host>`, then recreate the `keycloak` and `portal` containers and verify the full login round trip.

---

## 13. Scanner deployed on purple (2026-09-12)

The ASV scanner stack now runs on purple alongside the portal, behind the same edge.

### What is where

| Piece | Location |
|---|---|
| Dashboard (built) | `deploy/vps/scanner-dist/` — served under `/scanner/` |
| Scanner API + DB | compose project `ds-asv-scanner` (`deploy/vps/scanner.compose.yml`) |
| Code | `scanner/` on purple (rsynced from the repo, minus venv/node_modules/cache) |
| CVE cache | `scanner-data/greenbone_cves.json` — 236 MB, **171,007 records** |
| Evidence | `scanner-data/evidence/` |
| Operator token | `scanner-data/operator-token.txt` (mode 0600 — **read it yourself; never paste it in chat**) |

### Edge routing (added to `nginx.conf`)

```
/scanner/   -> the built dashboard (static, SPA fallback to /scanner/index.html)
/v1/        -> scanner-api:8000   (its own namespace — the portal owns /api/v1/)
```

The scanner stack joins the portal's network as an **external** network (`ds-asv-portal_default`), so nginx resolves `scanner-api` by name. Backups: `nginx.conf.bak-scanner`, `compose.yml.bak-scanner`.

Deliberately a **separate compose project**: the scanner has its own database and lifecycle, and rebuilding it must never touch the portal.

### Verified live (not assumed)

**Authenticated UI confirmed by the user on 2026-09-12** — they signed in through `https://74.156.0.13:8443/scanner/` with the operator token, so the browser path is verified end to end and not just the API.

```
/scanner/       -> 200 text/html        /       -> 200   portal intact
/scanner/scans  -> 200 text/html        /app/   -> 200   customer UI intact
/v1/health      -> 200 {"status":"ok","service":"asv-scanner-api"}
scanner-api     Up (healthy) · restarts=0
```

A real scan **through the public edge on purple**: customer scoped to the real test target (`45.33.32.156/32` — no `0.0.0.0/0` widening), scan `ba5fc885…` completed **FAIL** in ~65s with **31 findings (4 critical, 9 high, 15 medium, 3 low)** — CVE-2023-38408, CVE-2016-1908, CVE-2026-60002, CVE-2008-3844 among them. Same result as the heaven run, which proves the Greenbone cache loaded rather than the demo CPEMapper.

### Three bugs hit and fixed during the deploy

1. **zsh does not word-split variables.** `C="sudo docker compose …"; $C build` fails with `no such file or directory` (exit 127) on purple's zsh. Write compose commands out in full in remote scripts.
2. **0600 source files broke the container.** 20 files in `scanner/` were mode `-rw-------` on heaven; `rsync -a` preserved that into the image, and the non-root `app` user could not import its own modules — the API crash-looped with `PermissionError: /app/app/scoring/base.py`. Fixed at the source (`chmod 644`, excluding `*.env`/keys), not just on the host. **Check file modes before packaging.**
3. **`SCHEMA_READY` before `up`.** Gunicorn runs 4 workers, each firing the app's startup hook; creating the schema once up front avoids four concurrent `create_all` calls on a fresh database.

### Secrets

`SCANNER_DB_PASSWORD` and `SCANNER_API_TOKEN` were generated on purple with `openssl rand` and appended to `/home/cchock/projects/ds-asv-portal/.env` — values never echoed. `MANIFEST_SECRET` is reused from the portal so signed manifests verify on both sides. `APP_MODE=prod`, so `config_guard` refuses placeholder credentials at startup — a misconfigured deploy fails loudly instead of running insecurely.

### Not done

- **QSA token** (`API_QSA_TOKEN`) is unset, so the QSA role path is not exercisable on purple yet.
- **Cache refresh on purple** is manual. Purple runs Greenbone itself, so the correct long-term move is to build the cache there via `scripts/refresh_greenbone_cache.sh` rather than shipping 236 MB from heaven.
- The dashboard loads Google Fonts from the public internet; self-hosting is still an open item.

---

## 14. Portal ↔ scanner linked, and a real scan through the portal (2026-09-12)

The two apps were deployed but not connected. Linking them needs **two legs**, because
the portal dispatches scans and the scanner calls back with results.

### The forward leg: portal → scanner

- `SCANNER_BASE_URL: http://scanner-api:8000` added to the `portal` service in
  `deploy/vps/compose.yml`. The portal's `environment:` is an **explicit list**, so putting
  this in `.env` alone would never reach the container — adding it to the compose is what
  actually links them. No new network was needed: the scanner already joins the portal's
  default network as `external`, and the portal resolves `scanner-api` by name.
- **Bug fixed:** the portal health-checked `${SCANNER_BASE_URL}/health`, but the scanner
  serves **`/v1/health`** (dispatch correctly used `/v1/manifests`). The portal's own test
  asserted the wrong path, so it stayed green while the integration could never pass.
  `portal/src/lib/scan/health.ts` and its test now use `/v1/health`.

### The backward leg: scanner → portal

- The scanner writes status and findings back to `PORTAL_BASE_URL`, which was
  `https://${PUBLIC_HOST}` — the public edge, whose certificate is self-signed:

  ```
  portal status update failed: [SSL: CERTIFICATE_VERIFY_FAILED]
  certificate verify failed: self-signed certificate
  ```

- Fixed by pointing it at the **internal service DNS**:
  `PORTAL_BASE_URL: ${PORTAL_INTERNAL_URL:-http://portal:3000}`. The traffic never leaves
  the docker network, so there is no certificate to verify. Trusting the self-signed cert
  inside the container was the alternative; internal DNS is simpler and matches the forward leg.

### Two prod gates that apply (real gates, not bugs)

1. **Verification.** `createScanFromAssets` refuses an unverified asset in prod
   (`asset scanme.nmap.org is not verified (required in prod)`). Verification lasts 90 days;
   the challenge lives 24h.
2. **Approved scope.** The asset must be in an *approved* scope version.

Worth knowing: **DNS TXT verification requires control of the domain** (`_asv-verify.<fqdn>`),
so an asset you don't control can only be verified with `method: "manual"`, which returns the
token to the caller. For `scanme.nmap.org` (not our domain) manual was the only path.

### End-to-end proof, through the public edge, as the signed-in customer

`scanme.nmap.org` added as an fqdn asset → scope version **v1 approved** → scan
`Q3 2026 - scanme.nmap.org` → dispatched → **COMPLETED in ~40s with 31 findings: 4 critical,
9 high, 15 medium, 3 low** (CVE-2026-60002, CVE-2023-38408, CVE-2016-1908, CVE-2008-3844) —
identical to the heaven baseline. The UI reads Assets ✔ 1 of 1 verified · Scope ✔ v1 approved ·
Scans ✔ 1 this quarter.

### Gaps found while doing it

- **No scan-detail route** in the customer UI (`/reports/:reportId` exists, `/scans/:id` does
  not), so findings cannot yet be reviewed there.
- **`/assets/new` and `/assets/import` are still placeholders** ("second pass") — assets have to
  be created through the API for now.
- **The scan target status stays `pending`** after the scan completes, while the scan itself is
  `COMPLETED`; the target row is never advanced.
- **Dispatch is synchronous**: the scanner runs the entire scan inside the
  `POST /v1/manifests` request, so the portal's dispatch call blocks for the scan's duration
  (~40s). Any client or proxy timeout shorter than the scan reports a failure for a scan that
  actually ran — exactly what happened here at 5s before the run was confirmed complete.
