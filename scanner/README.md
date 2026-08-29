# ASV Scanner — Ground-Up Implementation

> Production blueprint for an PCI SSC Approved Scanning Vendor (ASV) platform with authenticated scanning capabilities.

Runtime baseline: Python 3.13.

## Documents

| File | What |
|------|------|
| `docs/ASV-Scanner-Deep-Dive.md` | Architecture, pitfalls, SOC 2 choke points |
| `docs/ASV-Authenticated-Scanning-Framework.md` | Auth scanning taxonomy, credential architecture |
| `docs/ASV-Implementation-Guide.md` | Complete code, Terraform, Vault policies, runbooks |
| `TODO.md` | Current implementation priorities and known issues |
| `HISTORY.md` | Concise dated development-session history |

## Project Layout

```
asv-scanner/
├── app/
│   ├── api/                FastAPI routes
│   ├── scanners/           SSH / WinRM / SNMP connectors
│   ├── scoring/            CVSS + PCI pass/fail engine
│   ├── reports/            SAR PDF generation
│   ├── tasks/              Celery background jobs
│   └── models/             SQLAlchemy models
├── infra/
│   ├── terraform/          Multi-region scanner fleet (AWS)
│   ├── docker/             MinIO evidence storage
│   └── vault/              HCL policies for dynamic SSH certs
├── target-agents/
│   ├── linux/              Restricted shell + setup script
│   └── windows/            WinRM hardening PowerShell
└── tests/
    └── fixtures/           Vulnerable target definitions
```

## Quick Start

```bash
# 1. Dev environment
make install        # Python venv + deps
make vault-dev      # HashiCorp Vault container
make test           # Unit tests

# 2. Local scan against test target
make scan-example   # Requires test VM with asvscan user

# 3. Deploy scanner fleet
make deploy-staging # Terraform apply
```

## Basic Customer Portal

After starting the API, open `http://127.0.0.1:8000/portal`. Enter the bearer
token configured in `API_BEARER_TOKEN`, choose an existing active customer, and
submit one IP address or hostname from that customer's approved `scope_ips`.
The portal runs the existing standard (`auth_method: none`) scan and displays
status and findings from the private API. The backend remains authoritative for
scope enforcement and rejects empty or out-of-scope targets.

After that authorization gate, a generic scan of one individual IP with no
explicit port uses the Nmap profile equivalent to `nmap -sC -A -Pn <target-ip>`.
The scanner applies a 180-second tool timeout. CIDRs are scope boundaries only
and are never passed to this final individual-IP profile. The container grants
only the network capabilities Nmap needs for `-A` while retaining its non-root
application user.

```bash
API_BEARER_TOKEN=dev-token \
DATABASE_URL=postgresql+psycopg2://asv:CHANGE_ME@localhost:8880/asv_scanner \
  .venv/bin/uvicorn app.api.main:app --reload
```

## Status

This is a research & architecture repository. See `docs/` for full specifications.
