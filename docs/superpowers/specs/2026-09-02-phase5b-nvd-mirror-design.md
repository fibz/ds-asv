# Phase 5b — Self-Hosted NVD CVE Mirror with Pluggable CVE Sources — Design Spec

> **Status:** Approved by user 2026-09-02.
> **Companion docs:** Phase 3b plan (`docs/superpowers/plans/2026-08-31-phase3b-scanner-service-integration.md`) — the CVE/scoring-source deferral this phase resolves; design spec §5 (report structure / scoring); Phase 5 handoff in AGENTS.md ("Phase 5b = CVE/scoring source … lives in the scanner service").

## 1. Purpose

The scanner already scores findings through `app/scoring/` (`cpe_mapper.py` + `pci_rules.py` + `nvd_loader.py` + `engine.py`). Phase 3b explicitly deferred the user directive to switch the CVE data source from the hardcoded demo table to a **real, self-hosted NVD mirror** (tracked follow-up). Phase 5b delivers that mirror AND introduces the **`CVESource` interface** — the checkpoint the user asked for — so a Greenbone API (or VulDB) source can be added later as a drop-in implementation with no engine changes.

## 2. Scope

**In scope (Phase 5b):**
- `CVESource` protocol (the seam): a test fake proves the engine is source-agnostic.
- `NVDMirrorSource`: full NVD feed bootstrap + modified-feed incremental refresh, JSON cache at `$NVD_FEED_PATH`, temp-write-then-rename for crash safety, idempotent merge.
- Scoring refactor: the `ASVScoringEngine` reads through a `CVESource` instead of the `CPEMapper` hardcoded table directly; `CPEMapper` becomes the NVD-backed implementation (or is absorbed by `NVDMirrorSource` — implementation detail, interface is what matters).
- Refresh wiring, BOTH manual and scheduled (user's explicit ask):
  - `scripts/update_nvd.py` → thin CLI over `NVDMirrorSource.refresh()` (full bootstrap + incremental modes).
  - Celery beat entry `cve-mirror-refresh` (daily) in `app/tasks/celery_app.py` + a `refresh_nvd_cache` task, following the existing `dispatch_scan` broker/no-broker fallback pattern.
- NVD feed parse tests against real NVD CVE 1.1 entries (exact + range matches), incremental-merge tests, idempotency, corrupt-temp-fallback, CLI tests with local fixtures (no network).
- Executor regression: `execute_manifest` still scores + posts findings (with a fake source).

**Out of scope (NOT in 5b):**
- Greenbone/VulDB implementations — protocol + design notes only, plus the test fake that proves the seam.
- SQLite migration — cache stays JSON (`build_cache_from_feed`'s `{versioned, ranges}` shape).
- Portal-side changes — `FindingIngest` already carries `cveId`/`severity`/`pciSeverity`; the portal contract is unchanged.

## 3. Architecture

```
app/scoring/
├── base.py                NEW  CVESource Protocol: lookup(product, version) -> list[CVEData]
│                                + refresh() + describe()  (greenstone-source later: implements this)
├── cpe_mapper.py          MOD  NVD-backed CVESource implementation (or renamed/absorbed —
│                                keep or adapt lookup_cves(name, version) used by engine)
├── nvd_mirror.py          NEW  NVDMirrorSource: cache load/save/normalize/merge + refresh
├── nvd_loader.py          MOD  unchanged parse logic; verify exports used by mirror
├── engine.py              MOD  ASVScoringEngine takes a CVESource (default NVD-backed);
│                                score_inventory/score_unauthenticated call source.lookup
├── greenbone_source.py    (DEFERRED) stubbed module: protocol conformance notes + TODO adapter
└── types.py               MOD  add CVEData dataclass (or reuse dict shape — see 4.2)
```

**The checkpoint (user asked):** `CVESource` is the one seam. NVD implements it now; **Greenbone API later = one new class implementing `lookup()`**, wired in where the engine's default source is constructed. A fake source in tests proves the engine never depends on NVD specifics.

## 4. Key decisions

### 4.1 Feed scope — full once + modified incremental (user's choice)
- Bootstrap: full NVD CVE feed (`nvdcve-1.1-*.json.gz` year files, or the single `nvdcve-1.1.json.gz` all-in-one — loader must accept either; see 4.6) → `build_cache_from_feed` per file, merge into cache.
- Incremental: NVD "modified" feed (`nvdcve-1.1-modified.json.gz`, ~last 8 days) on each scheduled refresh; new versions of a CVE supersede the cache entry by `cve_id`; entries absent from the modified feed stay (no expiry — the mirror grows monotonically; a full rebuild is the documented recovery path).
- Merge rule: for each modified-feed CVE, replace all prior cache entries with that `cve_id` (both versioned and ranges buckets) with the fresh data. Never duplicates.

### 4.2 Cache representation
- Keep `build_cache_from_feed`'s `{"versioned": {product:version: [cve...]}, "ranges": {product: [{cve, versionStartIncluding?, versionEndExcluding?}]}}` JSON at `$NVD_FEED_PATH` (default `./data/nvd_cache.json`).
- `CVEData` typed dataclass in `types.py` (`cve_id, title, description, cvss_score, cvss_vector`) — the source returns these; `ScoredFinding`s are built from them. Conversion from the dict cache is a thin adapter.

### 4.3 Refresh — BOTH manual and scheduled (user's ask)
- `scripts/update_nvd.py`: `--full` (bootstrap all year feeds) and `--incremental` (default — modified feed), `--url`/`--feed`/`--out` flags retained. Writes via temp file + atomic rename.
- `app/tasks/scanner_tasks.py`: `refresh_nvd_cache(full: bool = False)` task; `celery_app.conf.beat_schedule` gains `cve-mirror-refresh` daily (e.g. `crontab(minute=17, hour=3)`), scheduled only when a broker is configured (mirror `dispatch_scan`'s `broker_configured()` guard — no broker → no schedule, manual script is the path; documented).

### 4.4 Crash safety / idempotency
- Download to `*.tmp` in the target dir, validate JSON parse + non-empty, then `os.replace` to the final path. A failed/corrupt refresh never clobbers the last good cache.
- Concurrent refreshes: a lockfile (`$NVD_FEED_PATH.lock`, `fcntl` on POSIX / best-effort) — a second refresh either waits or aborts cleanly. (Simplest correct: `O_CREAT|O_EXCL` lock with stale-lock timeout; document.)

### 4.5 No-network/dev behavior
- No cache file + no feed configured → the engine falls back to the existing `_demo_lookup`/hardcoded table WITH the existing warning log (keeps dev/test runs working without network; unchanged behavior, but now explicitly behind the `CVESource` fallback path).
- `NVDMirrorSource.refresh()` with no network → raises a clear error; the previous cache remains.

### 4.6 NVD feed sources
- Use NVD JSON 1.1 feeds (the loader already parses that shape). Full bootstrap URLs: `https://nvd.nist.gov/feeds/json/cve/1.1/nvdcve-1.1-{2002..currentYear}.json.gz` (per-year split is the standard, streamable form); incremental: `nvdcve-1.1-modified.json.gz`. `NVD_API_KEY` env optional for higher rate limits. All URLs configurable via flags/env for offline/air-gapped deploys.

## 5. Testing (pytest, `scanner/tests/`)

| Test file | Coverage |
|---|---|
| `test_cve_source.py` | `CVESource` protocol contract: a fake source drives `ASVScoringEngine.score_unauthenticated`/`score_inventory`; engine returns ScoredFindings with `cve_id`, `cvss_score`, `severity`, `pci_fail`, `requires_dispute` as the source dictates — proves the checkpoint. |
| `test_nvd_mirror.py` | `NVDMirrorSource`: load valid cache; normalize both shapes (dict-feed vs list fixture); incremental merge (same CVE supersedes, absent CVEs persist, no dups); idempotent re-run; corrupt tmp → previous cache intact; missing file → demo fallback path. |
| `test_nvd_loader.py` (extend) | Real NVD CVE 1.1 fixture entries: exact version match, range match (versionStartIncluding/EndExcluding), `_parse_cpe` edge cases. |
| `test_update_nvd_cli.py` | `scripts/update_nvd.py` with local fixture feeds (`--feed`), `--full` + `--incremental`, `--out` writes valid cache. No network. |
| `test_executor.py` (extend) | `execute_manifest` with a fake CVESource: findings posted with `cveId`/`pciSeverity` unchanged by the refactor. |
| `test_engine_cve_source.py` (or folded) | Engine default-source construction without a cache → demo fallback (existing behavior preserved). |

## 6. Exit criteria

1. `CVESource` interface exists; a fake source drives the engine in tests (checkpoint proven).
2. `NVDMirrorSource` builds a valid cache from real NVD feeds (fixture/offline in CI; live download verified manually once), merges incrementally without dupes, survives a corrupt temp file.
3. `scripts/update_nvd.py` refreshes both modes; Celery beat entry + task exist and follow the broker-fallback pattern.
4. `execute_manifest` still scores and posts findings with the same `cveId`/`severity`/`pciSeverity` contract (executor regression green).
5. Scanner pytest suite green (baseline 20 tests + new); portal suite untouched & green.
6. AGENTS.md updated: Phase 5b DONE + NEXT (Greenbone/VulDB adapter when the user provisions a source).

## 7. Non-goals / follow-ups

- Greenbone API adapter: protocol + fixture-fake only, plus a `greenbone_source.py` stub documenting the interface conformance and the provisioning the user must do (install Greenbone Community Edition / OpenVAS or obtain a VulDB key).
- SQLite backend, feed expiry/GC, multi-tenant cache isolation (single scanner cache is fine for MVP).