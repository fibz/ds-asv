# purple — production deployment configuration (mirror)

These files are a **mirror of the live configuration on purple**, copied here so the production setup is reviewable in github. Until this directory existed, none of it was in the repo at all — which is how a deploy silently removed three auth fixes that lived only on the host and broke every login.

**Source of truth: the git repo on purple itself**, at `/home/cchock/projects/ds-asv-portal/` (baselined `55ad2f7`, 2026-09-12). These copies are for review and history. If they disagree with the host, **the host wins** — re-copy rather than editing here.

| File | Lives on purple at | What it does |
|---|---|---|
| `compose.yml` | `deploy/vps/compose.yml` | Portal stack: db, db-init, portal, keycloak, keycloak-db, proxy |
| `scanner.compose.yml` | `deploy/vps/scanner.compose.yml` | Scanner stack: its own db + api, joined to the portal network |
| `nginx.conf` | `deploy/vps/nginx.conf` | The edge on `:8443` — `/auth/` → keycloak, `/app/` → customer UI, `/scanner/` → scanner dashboard, `/v1/` → scanner API, `/` → portal |
| `portal.Dockerfile` | `portal/Dockerfile` | The portal image build (this file existed only on the host) |
| `render-realm.sh` | `deploy/vps/render-realm.sh` | Renders `realm.template.json` → `realm.json` with `PUBLIC_HOST` |
| `realm.template.json` | `deploy/vps/realm.template.json` | Templated Keycloak realm (contains no secrets) |

## NOT included (deliberately)

- `.env` — all real credentials, including `SCANNER_DB_PASSWORD` and `SCANNER_API_TOKEN`
- `certs/` — TLS material
- `realm.json` — the rendered realm; contains user credentials
- `scanner-data/` — operator token file, the 236 MB CVE cache, per-scan evidence

## Running the stack

```sh
cd /home/cchock/projects/ds-asv-portal/deploy/vps
ENVF=/home/cchock/projects/ds-asv-portal/.env      # two levels up, NOT ../.env

sudo docker compose --env-file "$ENVF" up -d                                            # portal
sudo docker compose --env-file "$ENVF" -f scanner.compose.yml up -d --build             # scanner
```

Note purple's shell is **zsh**: it does not word-split unquoted variables, so never store a command in a variable and call `$VAR` — write the command out in full.

## Before changing production

Re-run the source comparison between the repo and the host (see §11 of `hermes/customer/specs/2026-09-12-app-deployment.md`), and note the two Keycloak traps documented in §12: `--import-realm` does **not** update an existing realm, and resetting the realm deletes the `admin` user because it is not in the template.
