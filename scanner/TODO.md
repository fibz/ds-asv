# Project TODO

Updated: 2026-08-16

## Immediate priority

- [x] **Fixed automatic parent-scan aggregation/finalization** (2026-08-16).
  Added `_check_and_finalize_scan()` called from `_update_target_status()` after
  each target reaches a terminal state. Finalizes `scan.status = COMPLETED` and
  rolls up `scan.overall_result` from aggregated findings. Covers completed,
  failed, and mixed target outcomes; idempotent (safe to call repeatedly).
  Regression tests in `tests/unit/test_scan_finalization.py`.
  - Remaining gap: SAR route still guards on `ScanStatus.COMPLETED`; now reachable.
  - Open question: whether `is_suppressed` findings should still drive PCI fails
    (currently ignored — see code-review #19).

## Next steps

- Add an explicit worker service to the local Compose workflow and document how
  API background tasks differ from Celery-backed execution.
- Add end-to-end tests covering onboarding, CIDR authorization, an approved
  individual-IP scan, automatic parent finalization, persisted history, and
  reopening rich scan details after a page reload.
- Replace the single development bearer token with tenant-aware authentication
  before any non-development or untrusted-network deployment.
- Evolve the current customer CIDR list into versioned approved scope with
  immutable authorization attestations and audit history, following the
  onboarding design document.
- Add safe operational controls for cancellation, retry, stale-task detection,
  and reconciliation without changing or broadening approved scope.
- Complete production-readiness review for evidence retention, secret handling,
  TLS, rate limiting, observability, and network exposure.

## Guardrails to preserve

- Python 3.13 remains the local and container runtime baseline.
- CIDRs define approved boundaries; only an explicitly authorized individual IP
  is sent to the final Nmap profile.
- Backend scope enforcement remains authoritative. Empty, out-of-scope, or
  overly broad customer scopes must be rejected.
- Portal scan details must remain authenticated and curated; do not expose raw
  evidence paths, credentials, scanner commands, or execution logs by default.
