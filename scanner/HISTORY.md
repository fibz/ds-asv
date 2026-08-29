# Development History

## 2026-08-16 — Local private-scan portal milestone

- Aligned the application and Docker images on the declared Python 3.13 runtime
  and validated the project through container-based checks.
- Established a local Docker deployment. PostgreSQL, Redis, MinIO, and related
  dependencies remain loopback-bound; the development scanner API was made
  reachable on the trusted private network as an explicit local choice.
- Corrected portal bearer-token normalization and added a visibly labeled,
  loopback-only development-access helper without weakening backend auth.
- Reoriented customer setup around onboarding with one or more customer-provided
  narrow CIDRs plus explicit ownership/authorization confirmation. Persisted
  CIDRs are the customer's approved scope, and backend CIDR checks remain the
  authoritative scan gate.
- Added persisted customer scan history and clickable rich details that survive
  page reloads. Details show curated target status and timing, overall result,
  open ports/services/banner data where available, and findings while excluding
  raw internal paths, credentials, commands, and scanner logs.
- Fixed duplicate customer entries by using persistent customer IDs, and fixed
  stale history presentation with non-cacheable responses and client request
  ordering guards.
- Configured the final scan phase for one explicitly approved individual IP to
  use the project profile equivalent to `nmap -sC -A -Pn <target-ip>`, retaining
  validation, CIDR authorization, timeout handling, and audit context. This is
  not used for CIDR or bulk-range scans.

### Known issue

Automatic parent-scan aggregation/finalization is not yet reliable: a parent
record may remain nonterminal after its target records finish. Address this
before treating scan status as production-ready; see `TODO.md`.

### 2026-08-16 — Fix: parent-scan finalization

- Added `_check_and_finalize_scan()` in `app/tasks/scanner_tasks.py` that
  aggregates findings across all targets and sets `scan.status = COMPLETED`
  with `scan.overall_result = PASS/FAIL` when every target reaches a terminal
  state (completed, failed, or skipped).
- Called automatically from `_update_target_status()` after each target update,
  so the parent scan finalizes idempotently as the last target finishes.
- Covers pure-completed, pure-failed, and mixed target scenarios.
- SAR download (`/v1/scans/{id}/sar`) now becomes reachable once the scan is
  finalized (previously always 400 because `status` never reached `COMPLETED`).
- Regression tests added in `tests/unit/test_scan_finalization.py`.
