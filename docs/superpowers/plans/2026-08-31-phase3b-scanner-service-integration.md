# Phase 3b: Scanner Service Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the real Python scanner service (`scanner/`, FastAPI) a thin executor of the Phase 3 manifest + ingestion contract, replacing the portal's `simulatedScanner` test double: the scanner verifies a signed expiring scan-job manifest, runs a black-box scan per target, maps scored findings to the portal's `FindingIngest` shape, POSTs them back to the portal, and updates the portal scan lifecycle.

**Architecture (control-plane/executor split, per design spec §2):** The portal (Next.js + Prisma RLS) remains the source of truth for scans/reports. The scanner is a stateless executor: it receives a manifest token (issued by the portal), verifies it (HMAC + expiry), runs the existing `BlackBoxScanner` (nmap + testssl) per target, scores via the existing `ASVScoringEngine`, and writes findings + lifecycle back through the portal's authenticated ingestion endpoints. The scanner's legacy SQLAlchemy scan-orchestration DB (`Scan`/`Target`/`Finding` models) is NOT the source of truth for this flow — the manifest carries the targets; the scanner is deliberately thin. The existing scanner `/v1` API + Celery tasks are left in place (legacy), not reworked.

**Tech Stack:** Python 3.13+ (env is 3.14 — venv already created), FastAPI, httpx (portal client), `cryptography`/`hashlib.hmac` for HMAC-SHA256, pytest + pytest-asyncio + httpx/TestClient, black/isort/flake8/mypy (scanner lint gates).

**Spec:** `docs/superpowers/specs/2026-08-29-ds-asv-pci-portal-design.md` (§2 control-plane/executor split, §5 scan flow). Phase 3 contract (built in `docs/superpowers/plans/2026-08-31-phase3-scans-scan-reports.md`): manifest issued by portal `issueScanManifest`; ingestion route `POST /api/v1/scans/{scanId}/findings` accepts `Authorization: Bearer <manifest>` with `{findings:[FindingIngest]}`; lifecycle route `PATCH /api/v1/scans/{scanId}` `{status}`.

## Global Constraints

- **Control plane owns orchestration.** The portal decides what a scan is; the scanner only executes a verified manifest and reports findings back. The scanner never creates scans, never decides scope, never writes to the portal DB.
- **Manifest contract (verbatim, from Phase 3 Task 4 + the deep-canonicalization fix):**
  - Token format: `<b64url JSON payload>.<hex HMAC-SHA256 signature>`.
  - Payload: `{ scanId, organizationId, targets: [{type, canonicalIdentifier}], issuedAt, expiresAt, nonce }`.
  - Signed over a DEEP-canonicalized JSON string: recursively sort object keys at every level INCLUDING inside arrays (the Phase 3 final-review fix — an array-replacer form would collapse `targets[]` to `{}` and fail to cover target content). Signature is HMAC-SHA256 over that canonical JSON, hex digest.
  - TTL 15 minutes; verify rejects expired/tampered/malformed tokens (returns None, never throws).
  - Secret from `MANIFEST_SECRET` env; dev fallback `"dev-manifest-secret"` (portal `manifest.ts` uses the same fallback). In prod, `MANIFEST_SECRET` is REQUIRED (the scanner mirrors the portal's fail-closed check).
  - Never log a full manifest.
- **Ingestion contract (verbatim, from Phase 3):** `POST {portal}/api/v1/scans/{scanId}/findings` with `Authorization: Bearer <manifest>` and body `{ "findings": [FindingIngest] }` → `201 {count}`. `FindingIngest` required fields: `assetId`, `qid`, `severity` (enum "1".."5"), `title`; optional `cveId`, `pciSeverity` (High|Medium|Low), `description`, `threat`, `impact`, `result`. `assetId` in the posted finding MUST be the target's `canonicalIdentifier` — the portal resolves it to the real DB assetId (Phase 3 Ruling R2). `qid` is derived deterministically (scanner has no QID database). `severity` maps scanner severity → 1-5.
- **Lifecycle contract:** `PATCH {portal}/api/v1/scans/{scanId}` with `Authorization: Bearer <manifest>` and body `{status: RUNNING|COMPLETED|FAILED}`. The executor PATCHes RUNNING before scanning and COMPLETED/FAILED after.
- **Scanner test gate (scanner/AGENTS.md):** `make lint` (black, isort, flake8, mypy — must exit 0) and `make test` (pytest) must pass. The scanner currently has **no tests directory** — this plan creates the pytest harness (a `tests/` dir + `pytest.ini`/config) as Task 1.
- **No real network/tooling in tests.** `BlackBoxScanner.run()` shells out to nmap/testssl; tests MUST NOT invoke it. Executor code takes the scan executor as an injectable dependency (or a fake result) so unit/integration tests use a stub `ScanResult`, never real tooling. The portal client is exercised against `httpx`'s `MockTransport`, never a live portal.
- **The portal is not modified for the executor itself.** Phase 3's portal endpoints are already committed and green (274/274). Phase 3b changes ONLY `scanner/` (plus one small portal-side dispatch hook — see Task 5 — gated behind existing routes). Do not rework portal routes/services.
- **CVE/scoring source:** the existing `scanner/app/scoring/` (`cpe_mapper.py` hardcoded table + `pci_rules.py` + `nvd_loader.py` stub) is the scoring source for now. The user directive to switch to VulDB / Kali / Greenbone local DBs is tracked as a follow-up (Phase 4 / future) — it does NOT gate this phase; `cveId`/`severity`/`pciSeverity` are still just values the scanner posts.

---

## File Structure

```
scanner/
├── tests/
│   ├── conftest.py                  # NEW: pytest config, fixtures, shared helpers
│   └── ...
├── app/
│   ├── manifest.py                  # NEW: issue-independent verify (HMAC + expiry + parse) — Python port of portal manifest verify
│   ├── finding_mapping.py           # NEW: ScoredFinding → FindingIngest + severity/qid/pci mapping
│   ├── portal_client.py             # NEW: httpx client — POST findings + PATCH lifecycle to the portal
│   ├── executor.py                  # NEW: run one manifest end-to-end (verify → RUNNING → scan → score → map → POST → COMPLETED/FAILED)
│   └── api/
│       └── manifest_routes.py       # NEW: inbound dispatch endpoint POST /v1/manifests (receives manifest, enqueues executor)
portal/src/lib/scan/dispatch.ts      # MODIFY (Task 5): real dispatch that issues the manifest and POSTs to the scanner, replacing simulatedScanner as the prod dispatch
```

---

## Task 1: Scanner pytest harness + manifest verification

**Files:**
- Create: `scanner/tests/conftest.py`
- Create: `scanner/pytest.ini` (or add config to `setup.cfg`)
- Create: `scanner/app/manifest.py`
- Test: `scanner/tests/test_manifest.py`

**Interfaces:**
- Consumes: Python stdlib (`hmac`, `hashlib`, `json`, `base64`), `MANIFEST_SECRET` env (dev fallback `"dev-manifest-secret"`).
- Produces:
  - `verify_scan_manifest(token: str) -> dict | None` — verify a Phase 3 manifest; returns the parsed payload `{scanId, organizationId, targets, expiresAt, ...}` or `None` on any failure (never raises). Mirrors the portal's `verifyScanManifest` incl. deep canonicalization + timing-safe compare + expiry + type checks.
  - `manifest_secret() -> str` — `os.environ.get("MANIFEST_SECRET")` or `"dev-manifest-secret"`; raises in prod (`APP_MODE == "prod"`) when unset (fail-closed, mirroring the portal).
  - `deep_canonical_json(payload: dict) -> str` — recursively key-sorted JSON (objects sorted at every level, arrays mapped element-wise). Exported for the Task 2 mapping test to reuse.

- [ ] **Step 1: Create the pytest harness**

Create `scanner/pytest.ini`:
```ini
[pytest]
testpaths = tests
addopts = -ra --strict-markers
asyncio_mode = auto
```

Create `scanner/tests/conftest.py`:
```python
"""Shared pytest fixtures for the asv-scanner test suite."""
import os
import sys
from pathlib import Path

import pytest

# Make `app` importable from the repo root regardless of cwd.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Dev manifest secret by default so verify tests run without env setup.
os.environ.setdefault("MANIFEST_SECRET", "dev-manifest-secret")
os.environ.setdefault("APP_MODE", "dev")
```

- [ ] **Step 2: Write the failing manifest test**

Create `scanner/tests/test_manifest.py`:
```python
"""Tests for app.manifest — verify a Phase 3 scan-job manifest."""
import hmac
import json

import pytest

from app import manifest


def _sign(payload: dict, secret: str = "dev-manifest-secret") -> str:
    body = manifest.deep_canonical_json(payload)
    sig = hmac.new(secret.encode(), body.encode(), "sha256").hexdigest()
    return f"{manifest._b64url(json.dumps(payload))}.{sig}"


def _payload(**over) -> dict:
    base = {
        "scanId": "scan_1",
        "organizationId": "org_1",
        "targets": [{"type": "ipv4", "canonicalIdentifier": "10.1.1.1"}],
        "issuedAt": "2026-08-31T00:00:00Z",
        "expiresAt": "2026-08-31T00:15:00Z",
        "nonce": "abc123",
    }
    base.update(over)
    return base


def test_verify_accepts_valid_manifest():
    token = _sign(_payload())
    verified = manifest.verify_scan_manifest(token)
    assert verified is not None
    assert verified["scanId"] == "scan_1"
    assert verified["organizationId"] == "org_1"
    assert verified["targets"] == [
        {"type": "ipv4", "canonicalIdentifier": "10.1.1.1"}
    ]


def test_verify_rejects_tampered_target_content():
    # Mutate a nested target field (the deep-canonicalization case) but keep
    # the ORIGINAL signature — must fail because the signature no longer covers
    # the changed target.
    original = _sign(_payload())
    dot = original.index(".")
    body = manifest._b64decode(original[:dot])
    body = body.replace("10.1.1.1", "10.9.9.9")
    tampered = f"{manifest._b64url(body)}.{original[dot + 1:]}"
    assert manifest.verify_scan_manifest(tampered) is None


def test_verify_rejects_expired_manifest():
    token = _sign(_payload(expiresAt="2026-01-01T00:00:00Z"))
    assert manifest.verify_scan_manifest(token) is None


def test_verify_rejects_garbage():
    assert manifest.verify_scan_manifest("garbage") is None
    assert manifest.verify_scan_manifest("") is None


def test_deep_canonical_json_covers_nested_targets():
    a = _payload(targets=[{"type": "ipv4", "canonicalIdentifier": "10.1.1.1"}])
    b = _payload(targets=[{"type": "ipv4", "canonicalIdentifier": "10.9.9.9"}])
    assert manifest.deep_canonical_json(a) != manifest.deep_canonical_json(b)


def test_canonical_form_matches_portal_ts():
    # Cross-check (Ruling R5): the Python canonical form must be byte-identical
    # to the portal's TypeScript canonical() — JSON.stringify(sortKeysDeep(p)),
    # which is COMPACT (no spaces) with recursively-sorted keys. This locks in
    # the real portal→scanner manifest handoff.
    p = {
        "scanId": "scan_1",
        "organizationId": "org_1",
        "targets": [{"type": "ipv4", "canonicalIdentifier": "10.1.1.1"}],
        "issuedAt": "2026-08-31T00:00:00Z",
        "expiresAt": "2026-08-31T00:15:00Z",
        "nonce": "abc123",
    }
    # Node JSON.stringify output for this recursively-sorted payload:
    expected = (
        '{"expiresAt":"2026-08-31T00:15:00Z","issuedAt":"2026-08-31T00:00:00Z",'
        '"nonce":"abc123","organizationId":"org_1","scanId":"scan_1",'
        '"targets":[{"canonicalIdentifier":"10.1.1.1","type":"ipv4"}]}'
    )
    assert manifest.deep_canonical_json(p) == expected


def test_manifest_secret_fail_closed_in_prod(monkeypatch):
    monkeypatch.setenv("APP_MODE", "prod")
    monkeypatch.delenv("MANIFEST_SECRET", raising=False)
    with pytest.raises(RuntimeError):
        manifest.manifest_secret()
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_manifest.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.manifest'`.

- [ ] **Step 4: Implement the manifest module**

Create `scanner/app/manifest.py`:
```python
"""Verify the Phase 3 scan-job manifest.

The portal issues a signed, expiring manifest (``issueScanManifest``); the
scanner consumes it. This module is the scanner-side verifier: it recomputes
the HMAC-SHA256 signature over a DEEP-canonicalized JSON payload, checks
expiry, and parses the target snapshot. It never logs a full manifest.
"""

from __future__ import annotations

import base64
import hmac
import json
import os
from typing import Any, Optional

MANIFEST_TTL_MS = 15 * 60 * 1000
_DEV_SECRET = "dev-manifest-secret"


def manifest_secret() -> str:
    """Return the HMAC secret; fail-closed in prod when unset."""
    if os.environ.get("APP_MODE") == "prod" and not os.environ.get("MANIFEST_SECRET"):
        raise RuntimeError("MANIFEST_SECRET is required when APP_MODE=prod")
    return os.environ.get("MANIFEST_SECRET") or _DEV_SECRET


def _b64url(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode()
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64decode(data: str) -> str:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad).decode()


def deep_canonical_json(payload: dict) -> str:
    """Serialize with object keys recursively sorted, arrays preserved."""
    def _sort(value: Any) -> Any:
        if isinstance(value, dict):
            return {k: _sort(value[k]) for k in sorted(value)}
        if isinstance(value, list):
            return [_sort(v) for v in value]
        return value

    return json.dumps(_sort(payload), separators=(",", ":"), sort_keys=False)


def _signature(payload: dict) -> str:
    body = deep_canonical_json(payload)
    return hmac.new(manifest_secret().encode(), body.encode(), "sha256").hexdigest()


def verify_scan_manifest(token: str) -> Optional[dict]:
    """Verify a manifest token. Returns the payload dict or None (never raises)."""
    if not isinstance(token, str):
        return None
    try:
        dot = token.index(".")
        if dot < 1:
            return None
        payload_b64 = token[:dot]
        sig = token[dot + 1 :]
        payload = json.loads(_b64decode(payload_b64))
        if not isinstance(payload, dict):
            return None
        expected = _signature(payload)
        actual = sig
        if not hmac.compare_digest(expected, actual):
            return None
        expires_at = payload.get("expiresAt")
        if not isinstance(expires_at, str):
            return None
        import datetime

        try:
            expiry = datetime.datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except ValueError:
            return None
        if expiry.timestamp() <= datetime.datetime.now(datetime.timezone.utc).timestamp():
            return None
        for field in ("scanId", "organizationId"):
            if not isinstance(payload.get(field), str):
                return None
        if not isinstance(payload.get("targets"), list):
            return None
        return payload
    except Exception:
        return None
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_manifest.py -v`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
cd /home/cchock/projects/ds-asv/.worktrees/phase3b
git add scanner/tests scanner/app/manifest.py scanner/pytest.ini
git commit -m "test(scanner): pytest harness + manifest verifier (HMAC, expiry, deep canonical)"
```

---

## Task 2: Finding mapping (ScoredFinding → FindingIngest)

**Files:**
- Create: `scanner/app/finding_mapping.py`
- Test: `scanner/tests/test_finding_mapping.py`

**Interfaces:**
- Consumes: `ScoredFinding` from `app.scoring.types` (`title, description, cve_id, cvss_score, severity, pci_fail, source, ...`); the portal `FindingIngest` shape.
- Produces:
  - `scanner_severity_to_level(severity: str) -> str` — "critical"→"5", "high"→"4", "medium"→"3", "low"→"2", "info"→"1" (and anything else → "1").
  - `scanner_severity_to_pci(severity: str) -> str | None` — "critical"/"high"→"High", "medium"→"Medium", "low"/"info"→"Low" (or use `cvss_score` bands when available).
  - `derive_qid(cve_id, title, source) -> str` — deterministic 16-hex `sha256(f"{cve_id or ''}|{source or ''}|{title}")[:16]`, prefixed e.g. `q:`.
  - `map_finding(asset_canonical: str, sf: ScoredFinding) -> dict` — returns a portal `FindingIngest` dict with `assetId=asset_canonical`, `qid`, `severity`, `pciSeverity`, `cveId`, `title`, `description`, `threat`, `impact`, `result`. `threat`/`impact`/`result` may be omitted when not derivable.

- [ ] **Step 1: Write the failing mapping test**

Create `scanner/tests/test_finding_mapping.py`:
```python
"""Tests for app.finding_mapping — ScoredFinding → portal FindingIngest."""
from app.finding_mapping import (
    derive_qid,
    map_finding,
    scanner_severity_to_level,
    scanner_severity_to_pci,
)
from app.scoring.types import ScoredFinding


def test_severity_level_mapping():
    assert scanner_severity_to_level("critical") == "5"
    assert scanner_severity_to_level("high") == "4"
    assert scanner_severity_to_level("medium") == "3"
    assert scanner_severity_to_level("low") == "2"
    assert scanner_severity_to_level("info") == "1"
    assert scanner_severity_to_level("unknown") == "1"


def test_pci_mapping():
    assert scanner_severity_to_pci("critical") == "High"
    assert scanner_severity_to_pci("high") == "High"
    assert scanner_severity_to_pci("medium") == "Medium"
    assert scanner_severity_to_pci("low") == "Low"


def test_qid_is_deterministic():
    a = derive_qid("CVE-1", "title", "unauthenticated_probe")
    b = derive_qid("CVE-1", "title", "unauthenticated_probe")
    assert a == b
    assert a != derive_qid("CVE-2", "title", "unauthenticated_probe")


def test_map_finding_shape():
    sf = ScoredFinding(
        title="Weak TLS cipher",
        description="Weak ciphers detected",
        cve_id="CVE-2021-0000",
        cvss_score=7.8,
        severity="high",
        source="unauthenticated_probe",
    )
    out = map_finding("10.1.1.1", sf)
    assert out["assetId"] == "10.1.1.1"
    assert out["severity"] == "4"
    assert out["pciSeverity"] == "High"
    assert out["cveId"] == "CVE-2021-0000"
    assert out["title"] == "Weak TLS cipher"
    assert out["qid"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_finding_mapping.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.finding_mapping'`.

- [ ] **Step 3: Implement the mapping module**

Create `scanner/app/finding_mapping.py`:
```python
"""Map a scored scanner finding to the portal's FindingIngest shape."""

from __future__ import annotations

import hashlib
from typing import Optional

from app.scoring.types import ScoredFinding

_LEVELS = {
    "critical": "5",
    "high": "4",
    "medium": "3",
    "low": "2",
    "info": "1",
}

_PCI = {
    "critical": "High",
    "high": "High",
    "medium": "Medium",
    "low": "Low",
    "info": "Low",
}


def scanner_severity_to_level(severity: str) -> str:
    return _LEVELS.get(severity, "1")


def scanner_severity_to_pci(severity: str) -> Optional[str]:
    return _PCI.get(severity)


def derive_qid(cve_id: Optional[str], title: str, source: str) -> str:
    raw = f"{cve_id or ''}|{source or ''}|{title}"
    return "q:" + hashlib.sha256(raw.encode()).hexdigest()[:16]


def map_finding(asset_canonical: str, sf: ScoredFinding) -> dict:
    out = {
        "assetId": asset_canonical,
        "qid": derive_qid(sf.cve_id, sf.title, sf.source),
        "severity": scanner_severity_to_level(sf.severity),
        "title": sf.title,
        "description": sf.description or None,
        "cveId": sf.cve_id,
    }
    pci = scanner_severity_to_pci(sf.severity)
    if pci:
        out["pciSeverity"] = pci
    if sf.description:
        out["threat"] = sf.description
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_finding_mapping.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/cchock/projects/ds-asv/.worktrees/phase3b
git add scanner/app/finding_mapping.py scanner/tests/test_finding_mapping.py
git commit -m "feat(scanner): map ScoredFinding to portal FindingIngest (severity/qid/pci)"
```

---

## Task 3: Portal client (POST findings + PATCH lifecycle)

**Files:**
- Create: `scanner/app/portal_client.py`
- Test: `scanner/tests/test_portal_client.py`

**Interfaces:**
- Consumes: `httpx`; `PORTAL_BASE_URL` env (dev fallback `http://localhost:3000`); the manifest token.
- Produces:
  - `post_findings(manifest_token: str, scan_id: str, findings: list[dict]) -> int` — `POST {base}/api/v1/scans/{scan_id}/findings` with `Authorization: Bearer {manifest_token}`, body `{findings}`, via an injected `httpx.Client`. Returns `count` from the `201` response, or raises `RuntimeError` on non-201 / transport error.
  - `patch_scan_status(manifest_token: str, scan_id: str, status: str) -> None` — `PATCH {base}/api/v1/scans/{scan_id}` with `Authorization: Bearer {manifest_token}`, body `{status}`; raises `RuntimeError` on non-2xx.
  - `PortalClient` class holding a configured `httpx.Client` + base URL, with those two methods (so the executor can inject a mock transport in tests).

- [ ] **Step 1: Write the failing portal-client test**

Create `scanner/tests/test_portal_client.py`:
```python
"""Tests for app.portal_client — httpx calls to the portal."""
import httpx
import pytest

from app.portal_client import PortalClient


def _client_with(mock_transport):
    return PortalClient(
        base_url="http://portal.test",
        client=httpx.Client(transport=mock_transport),
    )


def test_post_findings_returns_count():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer m.abc"
        assert request.url.path == "/api/v1/scans/scan_1/findings"
        return httpx.Response(201, json={"count": 2})

    pc = _client_with(httpx.MockTransport(handler))
    count = pc.post_findings("m.abc", "scan_1", [{"assetId": "a"}])
    assert count == 2


def test_post_findings_raises_on_non_201():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "Invalid manifest"})

    pc = _client_with(httpx.MockTransport(handler))
    with pytest.raises(RuntimeError):
        pc.post_findings("m.abc", "scan_1", [{"assetId": "a"}])


def test_patch_status_sends_bearer_and_status():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["authorization"]
        seen["path"] = request.url.path
        seen["body"] = request.content
        return httpx.Response(200, json={})

    pc = _client_with(httpx.MockTransport(handler))
    pc.patch_scan_status("m.abc", "scan_1", "RUNNING")
    assert seen["auth"] == "Bearer m.abc"
    assert seen["path"] == "/api/v1/scans/scan_1"
    assert b"RUNNING" in seen["body"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_portal_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.portal_client'`.

- [ ] **Step 3: Implement the portal client**

Create `scanner/app/portal_client.py`:
```python
"""HTTP client for writing findings + lifecycle back to the portal.

The portal's ingestion route authenticates with ``Authorization: Bearer
<manifest>``. This client is deliberately thin: it posts findings and patches
scan status only.
"""

from __future__ import annotations

import os
from typing import Optional

import httpx


def portal_base_url() -> str:
    return os.environ.get("PORTAL_BASE_URL", "http://localhost:3000")


class PortalClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        client: Optional[httpx.Client] = None,
    ) -> None:
        self.base_url = (base_url or portal_base_url()).rstrip("/")
        self._client = client or httpx.Client(timeout=30)

    def close(self) -> None:
        self._client.close()

    def post_findings(
        self, manifest_token: str, scan_id: str, findings: list[dict]
    ) -> int:
        url = f"{self.base_url}/api/v1/scans/{scan_id}/findings"
        headers = {"Authorization": f"Bearer {manifest_token}"}
        try:
            resp = self._client.post(url, json={"findings": findings}, headers=headers)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"portal findings request failed: {exc}") from exc
        if resp.status_code != 201:
            raise RuntimeError(
                f"portal findings request failed: HTTP {resp.status_code}"
            )
        data = resp.json()
        return int(data.get("count", 0))

    def patch_scan_status(
        self, manifest_token: str, scan_id: str, status: str
    ) -> None:
        url = f"{self.base_url}/api/v1/scans/{scan_id}"
        headers = {"Authorization": f"Bearer {manifest_token}"}
        try:
            resp = self._client.patch(url, json={"status": status}, headers=headers)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"portal status update failed: {exc}") from exc
        if resp.status_code not in (200, 204):
            raise RuntimeError(f"portal status update failed: HTTP {resp.status_code}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_portal_client.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/cchock/projects/ds-asv/.worktrees/phase3b
git add scanner/app/portal_client.py scanner/tests/test_portal_client.py
git commit -m "feat(scanner): portal client — post findings + patch scan lifecycle"
```

---

## Task 4: Executor (run a manifest end-to-end)

**Files:**
- Create: `scanner/app/executor.py`
- Test: `scanner/tests/test_executor.py`

**Interfaces:**
- Consumes: `verify_scan_manifest` (Task 1), `PortalClient` (Task 3), `map_finding` (Task 2), `BlackBoxScanner` (existing), `ASVScoringEngine` (existing).
- Produces:
  - `execute_manifest(token: str, *, scanner_factory=None, client=None, engine=None) -> dict` — the thin-executor entry point. Verifies the manifest (None → raises `InvalidManifestError`); for each target: build a `BlackBoxScanner` via the injectable `scanner_factory(target)` (defaults to the real `BlackBoxScanner`), `run()`, and if `result.available` score via `engine.score_unauthenticated(result.banners, service)` grouped by service (mirroring the legacy `run_blackbox_scan` flow); map each `ScoredFinding` to a portal `FindingIngest` with `assetId = target["canonicalIdentifier"]`; PATCH `RUNNING` before scanning; `POST` all findings (deduped by `qid`) at the end; PATCH `COMPLETED` on success or `FAILED` on error. Returns `{"status": ..., "findings": <count>}`.
  - `InvalidManifestError(Exception)`.
  - `SCAN` status constants (`RUNNING`, `COMPLETED`, `FAILED`).

- [ ] **Step 1: Write the failing executor test**

Create `scanner/tests/test_executor.py`:
```python
"""Tests for app.executor — end-to-end manifest execution (stubbed scanner)."""
import hmac
import json
import sys
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app import manifest
from app.executor import execute_manifest, InvalidManifestError
from app.portal_client import PortalClient
from app.scoring.types import ScoredFinding


def _make_token(targets=None) -> str:
    payload = {
        "scanId": "scan_1",
        "organizationId": "org_1",
        "targets": targets or [{"type": "ipv4", "canonicalIdentifier": "10.1.1.1"}],
        "issuedAt": "2026-08-31T00:00:00Z",
        "expiresAt": "2030-01-01T00:00:00Z",
        "nonce": "x",
    }
    body = manifest.deep_canonical_json(payload)
    sig = hmac.new(b"dev-manifest-secret", body.encode(), "sha256").hexdigest()
    return f"{manifest._b64url(json.dumps(payload))}.{sig}"


class FakeScanner:
    def __init__(self, target):
        self.target = target

    def run(self):
        return SimpleNamespace(
            status="COMPLETED",
            target=self.target,
            available=True,
            banners=[{"service": "https", "port": 443, "tls_version": "TLSv1.0"}],
            raw={},
        )


def test_execute_manifest_success():
    from app import portal_client as pc_mod

    events = []
    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        events.append((request.method, request.url.path, request.content))
        if request.method == "POST":
            return httpx.Response(201, json={"count": 1})
        return httpx.Response(200, json={})

    client = PortalClient(
        base_url="http://portal.test",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    engine = SimpleNamespace(score_unauthenticated=lambda banners, service: [
        ScoredFinding(
            title="Deprecated TLS",
            severity="high",
            source="unauthenticated_probe",
        )
    ])
    result = execute_manifest(
        _make_token(),
        scanner_factory=FakeScanner,
        client=client,
        engine=engine,
    )
    assert result["status"] == "COMPLETED"
    assert result["findings"] == 1
    paths = [p for (_, p, _) in events]
    assert "/api/v1/scans/scan_1" in paths  # PATCH
    assert "/api/v1/scans/scan_1/findings" in paths  # POST


def test_execute_manifest_rejects_invalid():
    with pytest.raises(InvalidManifestError):
        execute_manifest("garbage")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_executor.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.executor'`.

- [ ] **Step 3: Implement the executor**

Create `scanner/app/executor.py`:
```python
"""Thin scan executor — consume a manifest, run the scan, report findings.

Control plane owns orchestration; this module is the scanner-side executor. It
verifies a manifest, runs a black-box scan per target, maps scored findings to
the portal's FindingIngest shape, posts them, and updates the portal lifecycle.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

from app.finding_mapping import map_finding
from app.manifest import verify_scan_manifest
from app.portal_client import PortalClient
from app.scanners.blackbox_connector import BlackBoxScanner
from app.scoring.engine import ASVScoringEngine

logger = logging.getLogger("asv.executor")

RUNNING = "RUNNING"
COMPLETED = "COMPLETED"
FAILED = "FAILED"


class InvalidManifestError(Exception):
    pass


def execute_manifest(
    token: str,
    *,
    scanner_factory: Optional[Callable[[str], object]] = None,
    client: Optional[PortalClient] = None,
    engine: Optional[ASVScoringEngine] = None,
) -> dict:
    """Run one scan from a signed manifest. Returns {status, findings}."""
    verified = verify_scan_manifest(token)
    if not verified:
        raise InvalidManifestError("invalid or expired manifest")
    scan_id = verified["scanId"]
    targets = verified["targets"]
    scanner_factory = scanner_factory or (lambda t: BlackBoxScanner(t))
    engine = engine or ASVScoringEngine()
    own_client = client is None
    client = client or PortalClient()

    client.patch_scan_status(token, scan_id, RUNNING)
    all_findings: list[dict] = []
    seen_qids: set[str] = set()
    try:
        for target in targets:
            canonical = target["canonicalIdentifier"]
            scanner = scanner_factory(canonical)
            result = scanner.run()
            if not getattr(result, "available", False):
                logger.warning("scan unavailable for %s: %s", canonical, result)
                continue
            banners = getattr(result, "banners", [])
            by_service: dict = {}
            for banner in banners:
                svc = banner.get("service", "unknown")
                by_service.setdefault(svc, []).append(banner)
            for service, svc_banners in by_service.items():
                scored = engine.score_unauthenticated(svc_banners, service)
                for sf in scored:
                    ingested = map_finding(canonical, sf)
                    qid = ingested["qid"]
                    if qid in seen_qids:
                        continue
                    seen_qids.add(qid)
                    all_findings.append(ingested)
        count = client.post_findings(token, scan_id, all_findings)
        client.patch_scan_status(token, scan_id, COMPLETED)
        return {"status": COMPLETED, "findings": count}
    except Exception as exc:
        logger.exception("scan %s failed", scan_id)
        try:
            client.patch_scan_status(token, scan_id, FAILED)
        except Exception:
            pass
        raise
    finally:
        if own_client:
            client.close()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_executor.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/cchock/projects/ds-asv/.worktrees/phase3b
git add scanner/app/executor.py scanner/tests/test_executor.py
git commit -m "feat(scanner): thin executor — verify manifest, scan, score, report to portal"
```

---

## Task 5: Inbound dispatch endpoint + portal-side dispatch hook

**Files:**
- Create: `scanner/app/api/manifest_routes.py` (+ register in `scanner/app/api/main.py`)
- Test: `scanner/tests/test_manifest_routes.py`
- Modify: `portal/src/lib/scan/dispatch.ts` (NEW)
- Test: `portal/src/lib/scan/dispatch.test.ts` (NEW)

**Interfaces:**
- Consumes: `execute_manifest` (Task 4); existing `scanner/app/api/main.py` router registration; portal's `issueScanManifest` (Phase 3) + `runScanWithSimulatedScanner` (Phase 3).
- Produces:
  - Scanner route `POST /v1/manifests` — body `{ "manifest": "<token>" }`; calls `execute_manifest` (in-process for MVP, or enqueue to Celery when a broker is configured). Returns `202 {"status": "accepted"}`; `400` on missing manifest field; `401` on invalid manifest.
  - Portal `dispatchScanToScanner(ctx, scanId): Promise<{findings:number}>` in `portal/src/lib/scan/dispatch.ts` — the real prod dispatch: `issueScanManifest(ctx, scanId)` → `POST {SCANNER_BASE_URL}/v1/manifests` with `{manifest}` → returns the accepted status. Uses `SCANNER_BASE_URL` env (dev fallback `http://localhost:8000`). This REPLACES `runScanWithSimulatedScanner` as the real dispatch path (the simulated double remains available for dev/tests, but prod dispatch uses the real scanner).
  - Add a portal route `POST /api/v1/scans/{scanId}/dispatch` (gate `scan.run`) that calls `dispatchScanToScanner` — so a client can trigger a real scan run.

- [ ] **Step 1: Write the failing scanner route test**

Create `scanner/tests/test_manifest_routes.py`:
```python
"""Tests for the inbound dispatch route."""
from fastapi.testclient import TestClient
from app.api.main import create_app


def test_manifest_route_accepts_valid():
    from unittest.mock import patch
    from app import manifest
    import hmac
    import json

    payload = {
        "scanId": "scan_1",
        "organizationId": "org_1",
        "targets": [{"type": "ipv4", "canonicalIdentifier": "10.1.1.1"}],
        "issuedAt": "2026-08-31T00:00:00Z",
        "expiresAt": "2030-01-01T00:00:00Z",
        "nonce": "x",
    }
    body = manifest.deep_canonical_json(payload)
    sig = hmac.new(b"dev-manifest-secret", body.encode(), "sha256").hexdigest()
    token = f"{manifest._b64url(json.dumps(payload))}.{sig}"

    with patch("app.api.manifest_routes.execute_manifest", return_value={"status": "COMPLETED", "findings": 0}):
        client = TestClient(create_app())
        resp = client.post("/v1/manifests", json={"manifest": token})
    assert resp.status_code == 202
    assert resp.json()["status"] == "accepted"


def test_manifest_route_rejects_missing():
    client = TestClient(create_app())
    resp = client.post("/v1/manifests", json={})
    assert resp.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_manifest_routes.py -v`
Expected: FAIL — route `/v1/manifests` not found (404).

- [ ] **Step 3: Implement the scanner route + register it**

Create `scanner/app/api/manifest_routes.py`:
```python
"""Inbound dispatch: receive a manifest and run it as a scan job."""
import logging

from fastapi import APIRouter, HTTPException

from app.executor import InvalidManifestError, execute_manifest

logger = logging.getLogger("asv.api.manifest")
router = APIRouter(prefix="/v1")


@router.post("/manifests", status_code=202)
def dispatch_manifest(body: dict):
    token = (body or {}).get("manifest")
    if not isinstance(token, str) or not token:
        raise HTTPException(status_code=400, detail="manifest is required")
    try:
        result = execute_manifest(token)
    except InvalidManifestError:
        raise HTTPException(status_code=401, detail="Invalid or expired manifest")
    except Exception as exc:
        logger.exception("manifest dispatch failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"status": "accepted", "result": result}
```

Register in `scanner/app/api/main.py` — add import + `app.include_router(manifest_router)`:
```python
from app.api.manifest_routes import router as manifest_router
# ...in create_app(): app.include_router(manifest_router)
```

- [ ] **Step 4: Run scanner route test to verify it passes**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_manifest_routes.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement the portal dispatch module + route test**

Create `portal/src/lib/scan/dispatch.ts`:
```ts
import { issueScanManifest } from "@/lib/scan/manifest";
import { getScan } from "@/lib/scan/service";
import type { TenantContext } from "@/lib/tenant";

const SCANNER_BASE_URL = process.env.SCANNER_BASE_URL || "http://localhost:8000";

/** Real prod dispatch: issue the manifest and hand it to the scanner service. */
export async function dispatchScanToScanner(
  ctx: TenantContext,
  scanId: string
): Promise<{ status: string }> {
  const scan = await getScan(ctx, scanId);
  if (!scan) throw new Error("Scan not found");
  const { manifest } = await issueScanManifest(ctx, scanId);
  const res = await fetch(`${SCANNER_BASE_URL}/v1/manifests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manifest }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`scanner dispatch failed (${res.status}): ${text}`);
  }
  return { status: "accepted" };
}
```

Create `portal/src/app/api/v1/scans/[scanId]/dispatch/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { dispatchScanToScanner } from "@/lib/scan/dispatch";

export async function POST(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scan.run")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { scanId } = await params;
  try {
    const result = await dispatchScanToScanner(ctx, scanId);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Dispatch failed" }, { status: 500 });
  }
}
```

Add a mocked route test `portal/src/app/api/v1/scans/[scanId]/dispatch/route.test.ts` (mock jose + prisma-client + `@/lib/scan/dispatch`; assert 403 for report_viewer, 401 no ctx, 202 for scan_operator). Follow the established Phase 3 route-test mock pattern.

- [ ] **Step 6: Run portal full suite**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run`
Expected: PASS — all tests (baseline 274 + new dispatch route test).

- [ ] **Step 7: Commit (both scanner and portal changes together)**

```bash
cd /home/cchock/projects/ds-asv/.worktrees/phase3b
git add scanner/app/api/manifest_routes.py scanner/app/api/main.py scanner/tests/test_manifest_routes.py portal/src/lib/scan/dispatch.ts portal/src/app/api/v1/scans/[scanId]/dispatch portal/src/lib/scan/dispatch.test.ts
git commit -m "feat: scanner inbound dispatch + portal dispatch hook (real executor, replaces simulated in prod)"
```

---

## Task 6: Exit criteria + handoff

**Files:**
- Create: `scanner/tests/test_exit.py`
- Modify: `scanner/AGENTS.md`, `AGENTS.md` (repo root)

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: the exit proof that the scanner consumes the Phase 3 contract end-to-end (manifest → findings → portal-shaped payload → lifecycle).

- [ ] **Step 1: Write the exit test**

Create `scanner/tests/test_exit.py`:
```python
"""Phase 3b exit criteria — scanner consumes the Phase 3 manifest contract."""
import hmac
import json

import httpx

from app import manifest
from app.executor import execute_manifest
from app.finding_mapping import map_finding
from app.scoring.types import ScoredFinding


def _token():
    payload = {
        "scanId": "scan_exit",
        "organizationId": "org_exit",
        "targets": [{"type": "fqdn", "canonicalIdentifier": "web.example.com"}],
        "issuedAt": "2026-08-31T00:00:00Z",
        "expiresAt": "2030-01-01T00:00:00Z",
        "nonce": "exit",
    }
    body = manifest.deep_canonical_json(payload)
    sig = hmac.new(b"dev-manifest-secret", body.encode(), "sha256").hexdigest()
    return f"{manifest._b64url(json.dumps(payload))}.{sig}"


def test_manifest_roundtrip_and_mapping():
    token = _token()
    verified = manifest.verify_scan_manifest(token)
    assert verified is not None
    assert verified["targets"][0]["canonicalIdentifier"] == "web.example.com"
    sf = ScoredFinding(title="TLS 1.0", severity="high", source="unauthenticated_probe")
    ingested = map_finding(verified["targets"][0]["canonicalIdentifier"], sf)
    assert ingested["assetId"] == "web.example.com"
    assert ingested["severity"] == "4"
    assert set(ingested) >= {"assetId", "qid", "severity", "title"}


def test_executor_reports_to_portal_via_mock():
    from app.executor import execute_manifest
    from app.portal_client import PortalClient

    events = []

    class FakeScanner:
        def __init__(self, target):
            self.target = target

        def run(self):
            from types import SimpleNamespace
            return SimpleNamespace(status="COMPLETED", target=self.target, available=True,
                                   banners=[{"service": "https", "port": 443}], raw={})

    class FakeEngine:
        def score_unauthenticated(self, banners, service):
            return [ScoredFinding(title="X", severity="medium", source="unauthenticated_probe")]

    def handler(request: httpx.Request) -> httpx.Response:
        events.append((request.method, request.url.path))
        if request.method == "POST":
            return httpx.Response(201, json={"count": 1})
        return httpx.Response(200, json={})

    client = PortalClient(base_url="http://p.test", client=httpx.Client(transport=httpx.MockTransport(handler)))
    result = execute_manifest(_token(), scanner_factory=FakeScanner, client=client, engine=FakeEngine())
    assert result["status"] == "COMPLETED"
    assert result["findings"] == 1
    paths = [p for (_, p) in events]
    assert "/api/v1/scans/scan_exit/findings" in paths
    assert "/api/v1/scans/scan_exit" in paths
```

- [ ] **Step 2: Run the scanner full test suite + lint gates**

Run: `cd scanner && .venv/bin/python -m pytest tests/ -v`
Expected: PASS — all tests.
Run: `cd scanner && .venv/bin/black app/ tests/ && .venv/bin/isort app/ tests/ && .venv/bin/flake8 app/ tests/ && .venv/bin/mypy app/ --ignore-missing-imports`
Expected: all exit 0.

- [ ] **Step 3: Run the portal full suite**

Run: `cd portal && npx --cache /home/cchock/projects/.npm-cache vitest run`
Expected: PASS — all tests (274 + new dispatch test).

- [ ] **Step 4: Update docs**

In `scanner/AGENTS.md`, add under the intro or a new "Integration" section: "The scanner is a thin executor of the portal's Phase 3 manifest contract. Inbound dispatch: `POST /v1/manifests`. It verifies a signed manifest (`app/manifest.py`), runs a black-box scan per target, maps findings (`app/finding_mapping.py`), and writes them + lifecycle to the portal via `app/portal_client.py`. The legacy SQLAlchemy scan orchestration is NOT the source of truth for this flow."

In repo-root `AGENTS.md`, update the `- **NEXT:** Phase 3b = ...` line to mark Phase 3b DONE and set NEXT to Phase 4 (versioned scope & authorization + dispute flow). Update the test-count line with the fresh portal full-suite result.

- [ ] **Step 5: Commit**

```bash
cd /home/cchock/projects/ds-asv/.worktrees/phase3b
git add scanner/tests/test_exit.py scanner/AGENTS.md AGENTS.md
git commit -m "test(scanner): Phase 3b exit criteria + docs: handoff to Phase 4"
```

---

## Self-Review

**Spec coverage:** §2 control-plane/executor split → Tasks 3-5 (scanner writes findings + lifecycle back to portal; portal owns orchestration via the dispatch hook). §5 scan flow → Task 4 (executor: manifest → scan → score → report). Phase 3 manifest + ingestion contract → Tasks 1-4 (verify, map, POST, PATCH). Scanner lint/test gates → Task 1 (harness) + Task 6 (full suite + lint). CVE source → explicitly deferred (NVD loader kept; VulDB/Kali/Greenbone tracked as follow-up).

**Placeholder scan:** every task carries exact code + commands; no TBD/TODO. The portal dispatch route test (Task 5 Step 5) is specified by template + enumerated assertions (same accepted approach as Phase 3's route tests). The `portal/src/lib/scan/dispatch.test.ts` file path is referenced but the test content is left to the implementer following the established route-test mock pattern — the route test is the concrete one.

**Type consistency:** `verify_scan_manifest` (Task 1) used in Tasks 4/6; `map_finding`/`derive_qid`/severity mappers (Task 2) in Tasks 4/6; `PortalClient.post_findings`/`patch_scan_status` (Task 3) in Tasks 4/6; `execute_manifest` + `InvalidManifestError` (Task 4) in Tasks 5/6. `assetId = target.canonicalIdentifier` consistent everywhere (portal R2 resolves it). `qid` derived deterministically from `(cve_id, source, title)` so dedupe is stable.

## Handoff note for Phase 4

Phase 3b wires the scanner as the portal's executor: `POST /v1/manifests` on the scanner consumes a manifest issued by the portal's `issueScanManifest`, runs the existing black-box scan + scoring, and writes findings + lifecycle back via the portal's Phase 3 ingestion/lifecycle routes (`POST /api/v1/scans/{scanId}/findings`, `PATCH /api/v1/scans/{scanId}`). The scanner's legacy SQLAlchemy scan-orchestration DB is not the source of truth for this flow and may be retired in a future phase. The CVE/scoring source remains the existing `cpe_mapper.py` hardcoded table + `pci_rules.py` + NVD loader stub; per user directive the next CVE work (VulDB or Kali/Greenbone local DBs) is deferred and feeds `cveId`/`severity`/`pciSeverity` into the findings the scanner posts. Phase 4 = versioned scope & authorization + dispute flow (portal-side).
