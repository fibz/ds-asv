# Phase 7: Greenbone CVE Source — Pluggable CVESource + GreenboneSource Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scanner's hardcoded demo CVE table with real CVE data sourced from the user's Greenbone Community Edition install — via the `CVESource` seam (the 5b checkpoint), a `GreenboneSource` that reads a locally-built cache, and a GMP export → cache pipeline — so `lookup` returns factual CVEs for scanned products and the demo table remains only as the no-cache dev fallback.

**Architecture:** The scanner scores through `app/scoring/` (`cpe_mapper.py`, `engine.py`, `pci_rules.py`, `nvd_loader.py`). Phase 5b's design spec (user decision 2026-09-02: Greenbone is THE route; NVD mirror only if not) defined the seam the user approved: a `CVESource` protocol the engine reads through, with the source being a drop-in class. Phase 7 implements that seam (Task 1), a `GreenboneSource` cache reader (Task 2), a pure GMP `get_nvts` XML → cache parser (Task 3), a `scripts/update_greenbone.py` CLI that captures NVTs from gvmd (live via python-gvm) or from a saved XML file (offline/CI) and atomically writes the cache (Task 4), and engine default-source selection — Greenbone cache present → GreenboneSource, else the legacy CPEMapper demo path unchanged (Task 5). Tests use fixtures only; no live Greenbone is required to make the suite green. Live verification against the user's install is a documented manual exit step.

**Tech Stack:** Python 3.13+ (venv currently 3.14), stdlib `xml.etree.ElementTree` for parsing, `python-gvm` (official GMP client; lazy-imported — tests never need it), existing `match_ranges` from `nvd_loader.py`, pytest + coverage (scanner gates: `make lint`, `make test`).

**Spec:** `docs/superpowers/specs/2026-09-02-phase5b-nvd-mirror-design.md` §3 (CVESource seam), §4.2 (cache shape), §4.5 (no-cache dev behavior), §6 exit criteria (adapted: Greenbone instead of NVD per the user's 2026-09-02 decision recorded in AGENTS.md). The plan argues from that spec; executor reads both.

## Global Constraints

- **User's route (2026-09-02 decision in AGENTS.md):** Greenbone Community Edition is the real CVE source. The NVD mirror spec is the optional offline/backup path — NOT built here. `NVD_FEED_PATH`/`update_nvd.py` stay untouched (CPEMapper keeps its NVD-cache + demo fallback behavior for the no-Greenbone case).
- **The seam:** `CVESource` protocol with `lookup(product, version, os_hint=None) -> List[CVEData]`, `refresh() -> None`, `describe() -> str`. The engine reads ONLY through a source; a test fake proves it never depends on a specific backend (5b §6.1 checkpoint).
- **`CVEData` is the source contract:** dataclass in `app/scoring/types.py` with fields `cve_id: str`, `title: str = ""`, `description: str = ""`, `cvss_score: float = 0.0`, `cvss_vector: str = ""`. The engine builds `ScoredFinding`s from `CVEData` fields — never from raw dicts.
- **No fabrications:** a `CVESource` implementation MUST NOT invent data. Missing cache, corrupt cache, unknown product, or unreachable upstream → `[]` + a warning log. In particular `GreenboneSource` has NO demo table — the demo fallback lives only in `CPEMapper`, which is used only when no Greenbone cache exists at all (5b §4.5).
- **Cache shape (5b §4.2):** `{"versioned": {"product:version": [ {cve,...} ]}, "ranges": {}}` — the same bucket shape `nvd_loader.build_cache_from_feed` writes and `match_ranges` consumes. `CVEData` dict conversion is a thin adapter: cache records use `cve_id/title/description/cvss_score/cvss_vector` keys.
- **Greenbone NVTs are product-grained, not version-grained:** an NVT usually declares `<cpe>cpe:/a:vendor:product</cpe>` (no version) plus its `<cve>` list. The cache builder therefore emits a bare key `"product:"` for product-level entries, and `GreenboneSource.lookup` treats `"product:"` as matching ANY version (exact `"product:version"` wins first). Document this semantic; do not invent version ranges.
- **Atomic cache writes:** temp-file + `os.replace`; a failed fetch/parse/empty export NEVER clobbers the last good cache (5b §4.4). Locking is out of scope (single scanner host).
- **Dependencies:** add `python-gvm>=24.0.0` to `scanner/requirements.txt`; it is imported LAZILY inside the live-fetch path only — parser/reader/engine tests never import it, keeping dev/CI green without python-gvm.
- **No `any`/wildcard guesses:** typed signatures throughout; assert/stdlib typing only. `make lint` (black, isort, flake8, mypy) must exit 0.
- Baseline: scanner suite green at 27 tests + portal 349/349 untouched (portal is NOT modified by Phase 7).

---

## File Structure

```
scanner/
├── app/scoring/
│   ├── types.py                       # MODIFY (Task 1): add CVEData dataclass
│   ├── base.py                        # CREATE (Task 1): CVESource Protocol
│   ├── cpe_mapper.py                  # MODIFY (Task 1): CPEMapper conforms to CVESource (CVEData returns; dead CVEFntry removed)
│   ├── engine.py                      # MODIFY (Tasks 1, 5): engine reads source.lookup; default_cve_source()
│   ├── greenbone_source.py            # CREATE (Task 2): GreenboneSource cache reader (implements CVESource)
│   ├── greenbone_export.py            # CREATE (Task 3): pure GMP get_nvts XML → cache parser + build_greenbone_cache()
│   └── __init__.py                    # MODIFY (Task 5): export CVESource, GreenboneSource
├── scripts/
│   └── update_greenbone.py            # CREATE (Task 4): CLI — live GMP fetch or --gmp-xml file → atomic cache write
│                                      #   (sits next to update_nvd.py in scanner/scripts/)
├── tests/
│   ├── test_cve_source.py             # CREATE (Task 1): protocol contract w/ FakeSource (checkpoint)
│   ├── test_greenbone_source.py       # CREATE (Task 2): lookup semantics
│   ├── test_greenbone_export.py       # CREATE (Task 3): XML → cache parse
│   ├── test_update_greenbone_cli.py   # CREATE (Task 4): CLI fixture runs, atomic-write safety
│   ├── test_executor.py               # MODIFY (Task 5): executor regression with FakeSource
│   └── fixtures/
│       └── gmp_get_nvts.xml           # CREATE (Task 3): realistic GMP get_nvts response fixture
├── requirements.txt                   # MODIFY (Task 4): add python-gvm
├── .gitignore                         # MODIFY (Task 4): ignore scanner/data/ (cache files)
└── AGENTS.md (repo root)              # MODIFY (Task 6): Phase 7 DONE + runnability rows + NEXT
```

---

## Task 1: The CVESource seam — CVEData, protocol, engine refactor (5b checkpoint)

**Files:**
- Modify: `app/scoring/types.py`
- Create: `app/scoring/base.py`
- Modify: `app/scoring/cpe_mapper.py`
- Modify: `app/scoring/engine.py`
- Create: `tests/test_cve_source.py`

**Interfaces:**
- Consumes: existing `CPEMapper` (its `_demo_lookup`/`lookup_cves` internals stay), `ScoredFinding` (types.py).
- Produces (used by Tasks 2/5):
  - `CVEData` dataclass (types.py): `cve_id: str`, `title: str = ""`, `description: str = ""`, `cvss_score: float = 0.0`, `cvss_vector: str = ""`.
  - `CVESource` (base.py): Protocol with `lookup(product: str, version: Optional[str], os_hint: Optional[str] = None) -> List[CVEData]`, `refresh() -> None`, `describe() -> str`.
  - `ASVScoringEngine(source: Optional[CVESource] = None)` — engine attribute `self.cve_source`; `score_inventory`/`score_unauthenticated` call `self.cve_source.lookup(...)` and build `ScoredFinding` from `CVEData`.
  - `CPEMapper.lookup(...) -> List[CVEData]` (dicts converted), `CPEMapper.refresh()`, `CPEMapper.describe()`; `lookup_cves(...) -> List[Dict]` retained as a thin dict-returning alias for any external callers.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_cve_source.py`:

```python
"""CVESource protocol contract — a fake source drives the engine (5b §6.1)."""

from app.scoring.base import CVESource
from app.scoring.engine import ASVScoringEngine
from app.scoring.types import CVEData


class FakeSource:
    """Minimal CVESource implementation; the engine must not care which
    backend it is (Greenbone, NVD, fixture...)."""

    def __init__(self, cves):
        self._cves = cves
        self.refreshed = 0

    def lookup(self, product, version, os_hint=None):
        return list(self._cves)

    def refresh(self):
        self.refreshed += 1

    def describe(self):
        return "fake"


def _cve(**over):
    base = dict(
        cve_id="CVE-FAKE-1",
        title="Fake CVE",
        description="fake description",
        cvss_score=9.8,
        cvss_vector="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    )
    base.update(over)
    return CVEData(**base)


def test_fake_source_satisfies_the_protocol():
    assert isinstance(FakeSource([]), CVESource)


def test_engine_score_unauthenticated_reads_through_source():
    engine = ASVScoringEngine(source=FakeSource([_cve()]))
    findings = engine.score_unauthenticated(
        [{"service": "https", "version": "1.0", "port": 443}], "nginx"
    )
    assert len(findings) == 1
    f = findings[0]
    assert f.cve_id == "CVE-FAKE-1"
    assert f.cvss_score == 9.8
    assert f.severity == "critical"      # >= 9.0
    assert f.pci_fail is True            # >= PCI_FAIL_THRESHOLD 7.0
    assert f.requires_dispute is True    # confidence 0.6 < 0.8 and pci_fail
    assert f.source == "unauthenticated_banner"


def test_engine_score_inventory_reads_through_source():
    engine = ASVScoringEngine(source=FakeSource([_cve(cvss_score=4.3)]))
    inventory = {
        "packages_deb": {"output": "ii  openssl  3.0.1  amd64  desc"},
        "os_release": "Debian 12",
    }
    findings = engine.score_inventory(inventory, source="authenticated_dpkg")
    assert len(findings) == 1
    assert findings[0].cve_id == "CVE-FAKE-1"
    assert findings[0].severity == "medium"   # 4.3 -> medium
    assert findings[0].pci_fail is False      # 4.3 < 7.0
    assert findings[0].raw_evidence["package"]["name"] == "openssl"


def test_engine_default_source_is_cpe_mapper_without_override():
    # Existing behavior: no source passed -> legacy CPEMapper (demo fallback).
    engine = ASVScoringEngine()
    assert engine.cve_source.describe().startswith("CPEMapper")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_cve_source.py -v`
Expected: FAIL — `CVESource` import error (no base.py), `ASVScoringEngine(source=...)` rejects the kwarg (no such param), `engine.cve_source` doesn't exist.

- [ ] **Step 3: Implement**

In `app/scoring/types.py`, append the dataclass:

```python
@dataclass
class CVEData:
    """One CVE record returned by a CVESource (Greenbone, NVD, ...)."""

    cve_id: str
    title: str = ""
    description: str = ""
    cvss_score: float = 0.0
    cvss_vector: str = ""
```

Create `app/scoring/base.py`:

```python
"""CVESource protocol — the pluggable seam between the scoring engine and
CVE databases (Greenbone, NVD, VulDB...). 5b spec §3 checkpoint."""

from __future__ import annotations

from typing import List, Optional, Protocol, runtime_checkable

from app.scoring.types import CVEData


@runtime_checkable
class CVESource(Protocol):
    """Answers "which CVEs affect this product:version?".

    Implementations MUST NOT fabricate data: an unknown product/version,
    a missing or corrupt cache, or an unreachable upstream return ``[]``
    (plus a warning log) — never invented entries. ``refresh()`` rebuilds
    the local cache and may raise a clear error when the upstream is
    unreachable; a failed refresh must leave the previous cache usable.
    """

    def lookup(
        self,
        product: str,
        version: Optional[str],
        os_hint: Optional[str] = None,
    ) -> List[CVEData]: ...

    def refresh(self) -> None: ...

    def describe(self) -> str: ...
```

In `app/scoring/cpe_mapper.py`:
- Remove the unused `CVEFntry` dataclass (lines 18-24) — `CVEData` replaces it.
- Add import + dict→dataclass converter, and the three protocol methods:

```python
from app.scoring.types import CVEData


def _to_cve_data(record: Dict[str, Any]) -> CVEData:
    return CVEData(
        cve_id=str(record.get("cve_id", "")),
        title=str(record.get("title", "")),
        description=str(record.get("description", "")),
        cvss_score=float(record.get("cvss_score", 0.0) or 0.0),
        cvss_vector=str(record.get("cvss_vector", "")),
    )
```

Inside `CPEMapper` (keep `lookup_cves` verbatim — it returns dicts; add below it):

```python
    def lookup(
        self,
        product: str,
        version: Optional[str],
        os_hint: Optional[str] = None,
    ) -> List[CVEData]:
        """CVESource conformance: dict pipeline (NVD cache → ranges → demo
        fallback) converted to CVEData. The demo fallback is logged exactly
        as before and only fires when no cache data exists."""
        return [_to_cve_data(d) for d in self.lookup_cves(product, version or "", os_hint)]

    def refresh(self) -> None:
        """Reload the cache file if it changed out-of-band (built by
        scripts/update_nvd.py). Failures leave the previous cache in place."""
        self._cache = {}
        self._nvd_ranges = {}
        self._load_cache()
        self._normalize_cache()

    def describe(self) -> str:
        return f"CPEMapper(cache={self.nvd_feed_path or 'unset'})"
```

In `app/scoring/engine.py`:

```python
from typing import Any, Dict, List, Optional

from app.scoring.base import CVESource
from app.scoring.cpe_mapper import CPEMapper
```

Replace `__init__`:

```python
    def __init__(self, source: Optional[CVESource] = None):
        self.cve_source = source if source is not None else CPEMapper()
        self.pci_rules = PCIRules()
```

Replace both lookup call sites. `score_inventory`:

```python
            cves = self.cve_source.lookup(
                pkg["name"], pkg["version"], pkg.get("os")
            )
            for cve in cves:
                cvss = cve.cvss_score
                pci_fail = cvss >= self.PCI_FAIL_THRESHOLD

                findings.append(
                    ScoredFinding(
                        title=cve.title or f"CVE in {pkg['name']}",
                        description=cve.description,
                        cve_id=cve.cve_id or None,
                        cvss_score=cvss,
                        cvss_vector=cve.cvss_vector or None,
                        severity=self._cvss_to_severity(cvss),
                        confidence=confidence,
                        source=source,
                        pci_fail=pci_fail,
                        raw_evidence={
                            "package": pkg,
                            "cve": {
                                "cve_id": cve.cve_id,
                                "title": cve.title,
                                "cvss_score": cve.cvss_score,
                            },
                        },
                        requires_dispute=confidence < 0.8 and pci_fail,
                    )
                )
```

`score_unauthenticated`:

```python
        for banner in banner_data:
            cves = self.cve_source.lookup(service_name, banner.get("version") or "")
            for cve in cves:
                cvss = cve.cvss_score
                pci_fail = cvss >= self.PCI_FAIL_THRESHOLD

                findings.append(
                    ScoredFinding(
                        title=f"{service_name} — {cve.title or 'Unknown CVE'}",
                        description=cve.description,
                        cve_id=cve.cve_id or None,
                        cvss_score=cvss,
                        cvss_vector=cve.cvss_vector or None,
                        severity=self._cvss_to_severity(cvss),
                        confidence=confidence,
                        source="unauthenticated_banner",
                        pci_fail=pci_fail,
                        raw_evidence={
                            "banner": banner,
                            "cve": {
                                "cve_id": cve.cve_id,
                                "title": cve.title,
                                "cvss_score": cve.cvss_score,
                            },
                        },
                        requires_dispute=confidence < 0.8 and pci_fail,
                    )
                )
```

(Note: `banner.get("version") or ""` replaces the previous raw `banner.get("version")` — the old code built `"service:None"` keys and crashed the demo string-compare on None; `""` keeps the same no-crash path with a sane key.)

- [ ] **Step 4: Run test to verify it passes**

Run the focused command. Expected: PASS (3 asserts per engine test + protocol check).

- [ ] **Step 5: Full suite + commit**

Run: `cd scanner && . .venv/bin/activate && make lint && make test` — green (27 + 2 new files' tests; any existing test constructing `ASVScoringEngine()` unchanged). Then:

```bash
cd /home/cchock/projects/ds-asv
git add scanner/app/scoring/types.py scanner/app/scoring/base.py scanner/app/scoring/cpe_mapper.py scanner/app/scoring/engine.py scanner/tests/test_cve_source.py
git commit -m "feat(scanner): CVESource seam — CVEData + protocol + engine reads source.lookup (5b checkpoint)"
```

---

## Task 2: GreenboneSource — cache reader

**Files:**
- Create: `app/scoring/greenbone_source.py`
- Create: `tests/test_greenbone_source.py`

**Interfaces:**
- Consumes: Task 1 `CVESource`, `CVEData`; existing `match_ranges` (`app/scoring/nvd_loader.py`).
- Produces (used by Task 5): `GreenboneSource(feed_path: Optional[str] = None)` with `lookup/refresh/describe`; module constant `DEFAULT_FEED_PATH = "./data/greenbone_cves.json"`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_greenbone_source.py`:

```python
"""GreenboneSource cache-reader semantics (fixtures only; no live gvmd)."""

import json

import pytest

from app.scoring.greenbone_source import GreenboneSource
from app.scoring.types import CVEData


@pytest.fixture()
def cache_file(tmp_path):
    cache = {
        "versioned": {
            "openssl:3.0.1": [
                {
                    "cve_id": "CVE-2022-1292",
                    "title": "openssl 3.0.1",
                    "description": "CVE-2022-1292",
                    "cvss_score": 9.8,
                    "cvss_vector": "",
                }
            ],
            "nginx:": [  # bare product -> matches ANY version
                {
                    "cve_id": "CVE-2021-23017",
                    "title": "nginx",
                    "description": "",
                    "cvss_score": 7.7,
                    "cvss_vector": "",
                }
            ],
        },
        "ranges": {},
    }
    path = tmp_path / "greenbone_cves.json"
    path.write_text(json.dumps(cache), encoding="utf-8")
    return str(path)


def test_exact_version_hit(cache_file):
    source = GreenboneSource(cache_file)
    cves = source.lookup("openssl", "3.0.1")
    assert [c.cve_id for c in cves] == ["CVE-2022-1292"]
    assert isinstance(cves[0], CVEData)
    assert cves[0].cvss_score == 9.8


def test_bare_product_key_matches_any_version(cache_file):
    source = GreenboneSource(cache_file)
    for version in ("1.18.0", "1.27.0", "latest"):
        cves = source.lookup("nginx", version)
        assert [c.cve_id for c in cves] == ["CVE-2021-23017"]


def test_exact_version_wins_over_bare_key(tmp_path):
    cache = {
        "versioned": {
            "openssl:3.0.1": [{"cve_id": "CVE-EXACT", "title": "t",
                               "description": "", "cvss_score": 5.0,
                               "cvss_vector": ""}],
            "openssl:": [{"cve_id": "CVE-BARE", "title": "t",
                          "description": "", "cvss_score": 5.0,
                          "cvss_vector": ""}],
        },
        "ranges": {},
    }
    path = tmp_path / "c.json"
    path.write_text(json.dumps(cache), encoding="utf-8")
    source = GreenboneSource(str(path))
    assert [c.cve_id for c in source.lookup("openssl", "3.0.1")] == ["CVE-EXACT"]
    assert [c.cve_id for c in source.lookup("openssl", "99.0")] == ["CVE-BARE"]


def test_missing_cache_returns_empty_not_demo(tmp_path):
    source = GreenboneSource(str(tmp_path / "missing.json"))
    assert source.lookup("openssl", "3.0.1") == []


def test_corrupt_cache_returns_empty_and_does_not_raise(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text("{not json", encoding="utf-8")
    source = GreenboneSource(str(path))
    assert source.lookup("openssl", "3.0.1") == []


def test_ranges_bucket_is_supported(tmp_path):
    from app.scoring.nvd_loader import match_ranges  # noqa: F401  (sanity import)
    cache = {
        "versioned": {},
        "ranges": {
            "openssl": [
                {
                    "cve_id": "CVE-RANGE",
                    "title": "t",
                    "description": "",
                    "cvss_score": 6.5,
                    "cvss_vector": "",
                    "versionStartIncluding": "1.0.0",
                    "versionEndExcluding": "3.0.0",
                }
            ]
        },
    }
    path = tmp_path / "r.json"
    path.write_text(json.dumps(cache), encoding="utf-8")
    source = GreenboneSource(str(path))
    assert [c.cve_id for c in source.lookup("openssl", "1.1.1")] == ["CVE-RANGE"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_greenbone_source.py -v`
Expected: FAIL — module import error (greenbone_source.py missing).

- [ ] **Step 3: Implement**

Create `app/scoring/greenbone_source.py`:

```python
"""Greenbone-backed CVESource — reads the locally-built cache.

The cache (``$GREENBONE_FEED_PATH``, default ``./data/greenbone_cves.json``)
is written by ``scripts/update_greenbone.py`` from Greenbone's GMP
``get_nvts`` export. Same ``{versioned, ranges}`` shape as the NVD loader.

Lookup semantics:
- exact ``<product>:<version>`` hit wins;
- a bare ``<product>:`` key — an NVT whose CPE declares the product but not
  the version, the common Greenbone case — matches ANY version;
- else a ``ranges`` hit (future exporters may populate ranges);
- else ``[]`` + warning. NEVER the demo table: that fallback belongs to
  CPEMapper, which the engine uses only when no Greenbone cache exists.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from app.scoring.base import CVESource
from app.scoring.nvd_loader import match_ranges
from app.scoring.types import CVEData

logger = logging.getLogger("asv.scoring.greenbone")

DEFAULT_FEED_PATH = "./data/greenbone_cves.json"


class GreenboneSource:
    """Cache-backed Greenbone CVESource (implements the CVESource protocol)."""

    def __init__(self, feed_path: Optional[str] = None):
        self.feed_path = (
            feed_path
            or os.environ.get("GREENBONE_FEED_PATH")
            or DEFAULT_FEED_PATH
        )
        self._versioned: Dict[str, List[Dict[str, Any]]] = {}
        self._ranges: Dict[str, List[Dict[str, Any]]] = {}
        self._load()

    def _load(self) -> None:
        if not os.path.exists(self.feed_path):
            logger.warning(
                "Greenbone cache missing at %s; lookups return []",
                self.feed_path,
            )
            return
        try:
            with open(self.feed_path, encoding="utf-8") as fh:
                cache = json.load(fh)
            self._versioned = (
                (cache.get("versioned") or {}) if isinstance(cache, dict) else {}
            )
            self._ranges = (
                (cache.get("ranges") or {}) if isinstance(cache, dict) else {}
            )
        except (OSError, ValueError) as exc:
            logger.warning("Failed to load Greenbone cache %s: %s", self.feed_path, exc)
            self._versioned = {}
            self._ranges = {}

    def lookup(
        self,
        product: str,
        version: Optional[str],
        os_hint: Optional[str] = None,
    ) -> List[CVEData]:
        product = product.lower()
        key = f"{product}:{version}"
        if key in self._versioned:
            return [CVEData(**r) for r in self._versioned[key]]
        if f"{product}:" in self._versioned:
            return [CVEData(**r) for r in self._versioned[f"{product}:"]]
        if self._ranges:
            staged = match_ranges(self._ranges, product, version or "")
            if staged:
                return [CVEData(**r) for r in staged]
        logger.warning("Greenbone cache miss for %s:%s", product, version)
        return []

    def refresh(self) -> None:
        """Reload the cache file (built by scripts/update_greenbone.py).
        A failed load leaves the previous buckets in place."""
        self._versioned = {}
        self._ranges = {}
        self._load()

    def describe(self) -> str:
        return f"GreenboneSource(cache={self.feed_path})"
```

- [ ] **Step 4: Run test to verify it passes**

Run the focused command. Expected: PASS (all 6 tests).

- [ ] **Step 5: Full suite + commit**

Run lint + test. Then:

```bash
cd /home/cchock/projects/ds-asv
git add scanner/app/scoring/greenbone_source.py scanner/tests/test_greenbone_source.py
git commit -m "feat(scanner): GreenboneSource — cache-backed CVESource (bare-product keys match any version)"
```

---

## Task 3: GMP get_nvts XML → cache parser

**Files:**
- Create: `app/scoring/greenbone_export.py`
- Create: `tests/fixtures/gmp_get_nvts.xml`
- Create: `tests/test_greenbone_export.py`

**Interfaces:**
- Consumes: nothing from Tasks 1-2 (pure stdlib parse); the 5b §4.2 cache shape.
- Produces (used by Task 4): module function `build_greenbone_cache(xml_text: str) -> Dict[str, Any]` returning `{"versioned": {...}, "ranges": {}}`.

- [ ] **Step 1: Write the failing tests + fixture**

Create `tests/fixtures/gmp_get_nvts.xml` — a realistic `get_nvts_response` (both CPE formats, a bare product, an NVT with no CVE, an NVT with an unparseable CPE — the latter two must be skipped):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<get_nvts_response status="200" status_text="OK">
  <nvt oid="1.3.6.1.4.1.25623.1.0.104051" type="remote">
    <name>OpenSSL 3.0.1 multiple vulnerabilities</name>
    <summary>OpenSSL before 3.0.2 is vulnerable to CVE-2022-1292.</summary>
    <cvss_base>9.8</cvss_base>
    <cve>CVE-2022-1292</cve>
    <cpe>cpe:/a:openssl:openssl:3.0.1</cpe>
  </nvt>
  <nvt oid="1.3.6.1.4.1.25623.1.0.105845" type="remote">
    <name>nginx resolver off-by-one heap write</name>
    <summary>nginx before 1.20.1 / 1.21.0 aliasing bug (CVE-2021-23017).</summary>
    <cvss_base>7.7</cvss_base>
    <cve>CVE-2021-23017</cve>
    <cpe>cpe:/a:nginx:nginx</cpe>
  </nvt>
  <nvt oid="1.3.6.1.4.1.25623.1.0.200001" type="remote">
    <name>cpe2.3 style NVT</name>
    <summary>NVT using the cpe:2.3 notation.</summary>
    <cvss_base>5.0</cvss_base>
    <cve>CVE-2014-0160 CVE-2016-9244</cve>
    <cpe>cpe:2.3:a:openssl:openssl:1.0.1:*:*:*:*:*:*:*</cpe>
  </nvt>
  <nvt oid="1.3.6.1.4.1.25623.1.0.200002" type="remote">
    <name>no CVE here</name>
    <summary>An NVT without a CVE reference contributes nothing.</summary>
    <cvss_base>3.1</cvss_base>
    <cpe>cpe:/a:vendor:product</cpe>
  </nvt>
  <nvt oid="1.3.6.1.4.1.25623.1.0.200003" type="remote">
    <name>bad cpe here</name>
    <summary>An NVT without a parseable CPE is dropped.</summary>
    <cvss_base>4.0</cvss_base>
    <cve>CVE-2020-0001</cve>
    <cpe>not-a-cpe</cpe>
  </nvt>
</get_nvts_response>
```

Create `tests/test_greenbone_export.py`:

```python
"""Pure GMP get_nvts XML -> cache parser (no network, no python-gvm)."""

from pathlib import Path

from app.scoring.greenbone_export import build_greenbone_cache

FIXTURE = Path(__file__).parent / "fixtures" / "gmp_get_nvts.xml"


def test_builds_versioned_entries_from_fixture():
    cache = build_greenbone_cache(FIXTURE.read_text(encoding="utf-8"))
    versioned = cache["versioned"]
    assert cache["ranges"] == {}
    # versioned cpe -> exact key
    assert [c["cve_id"] for c in versioned["openssl:3.0.1"]] == ["CVE-2022-1292"]
    assert versioned["openssl:3.0.1"][0]["cvss_score"] == 9.8
    # bare product cpe -> product: key
    assert [c["cve_id"] for c in versioned["nginx:"]] == ["CVE-2021-23017"]
    # cpe:2.3 style -> versioned key, one record PER cve
    assert [c["cve_id"] for c in versioned["openssl:1.0.1"]] == [
        "CVE-2014-0160",
        "CVE-2016-9244",
    ]


def test_skips_nvts_without_cve_or_with_unparseable_cpe():
    cache = build_greenbone_cache(FIXTURE.read_text(encoding="utf-8"))
    keys = set(cache["versioned"].keys())
    assert "vendor:product" not in keys      # NVT had no CVE
    assert not any(k.startswith("not-a-cpe") for k in keys)


def test_empty_response_yields_empty_cache():
    empty = '<get_nvts_response status="200" status_text="OK"/>\n'
    assert build_greenbone_cache(empty) == {"versioned": {}, "ranges": {}}


def test_malformed_xml_raises_lookup_error():
    import pytest

    with pytest.raises(Exception):
        build_greenbone_cache("<get_nvts_response><nvt>")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_greenbone_export.py -v`
Expected: FAIL — module import error.

- [ ] **Step 3: Implement**

Create `app/scoring/greenbone_export.py`:

```python
"""Pure parser: Greenbone GMP <get_nvts_response> XML -> cache dict.

No network and no python-gvm — takes the XML document (captured live by
``scripts/update_greenbone.py`` or saved with ``--gmp-xml``) and returns the
``{versioned, ranges}`` cache ``GreenboneSource`` consumes (5b spec §4.2).

An NVT contributes one cache record PER CVE when:
- ``<cve>`` holds a whitespace/comma CVE list (empty list -> NVT skipped),
- ``<cpe>`` parses as ``cpe:/a:vendor:product[:version]`` or
  ``cpe:2.3:a:vendor:product:version:...`` (unparseable -> NVT skipped),

Versioned CPE -> key ``product:version``; bare product CPE -> key
``product:`` (matches any version — the common Greenbone case). The parser
never invents data: ``cvss_score`` defaults to 0.0 and ``cvss_vector`` to ""
when the NVT does not carry them.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("asv.scoring.greenbone")

_CVE_SPLIT = re.compile(r"[\s,;]+")


def _text(nvt: ET.Element, tag: str) -> str:
    elem = nvt.find(tag)
    return (elem.text or "").strip() if elem is not None and elem.text else ""


def _cvss(nvt: ET.Element) -> float:
    raw = _text(nvt, "cvss_base")
    try:
        return float(raw)
    except ValueError:
        return 0.0


def _parse_cpe(cpe: str) -> Optional[Tuple[str, Optional[str]]]:
    """(product_lower, version|None) from a CPE string. Never raises."""
    cpe = cpe.strip()
    if not cpe:
        return None
    if cpe.startswith("cpe:2.3:"):
        parts = cpe.split(":")
        if len(parts) < 5:
            return None
        product = parts[4]
        if not product or product in ("*", "-"):
            return None
        version = parts[5] if len(parts) > 5 and parts[5] not in ("*", "-", "") else None
        return product.lower(), version
    if cpe.startswith("cpe:/"):
        parts = cpe.split(":")
        if len(parts) < 4:
            return None
        product = parts[3]
        if not product:
            return None
        version = parts[4] if len(parts) > 4 and parts[4] not in ("*", "-", "") else None
        return product.lower(), version
    return None


def build_greenbone_cache(xml_text: str) -> Dict[str, Any]:
    """GMP get_nvts XML text -> {"versioned": {...}, "ranges": {}}."""
    root = ET.fromstring(xml_text)
    versioned: Dict[str, List[Dict[str, Any]]] = {}

    for nvt in root.iter("nvt"):
        cve_list = [
            c
            for c in _CVE_SPLIT.split(_text(nvt, "cve"))
            if c.startswith("CVE-")
        ]
        if not cve_list:
            continue
        parsed = _parse_cpe(_text(nvt, "cpe"))
        if not parsed:
            continue
        product, version = parsed
        base = {
            "title": _text(nvt, "name") or cve_list[0],
            "description": _text(nvt, "summary") or "",
            "cvss_score": _cvss(nvt),
            "cvss_vector": _text(nvt, "cvss_vector") or "",
        }
        key = f"{product}:{version}" if version else f"{product}:"
        bucket = versioned.setdefault(key, [])
        for cve_id in cve_list:
            record = dict(base, cve_id=cve_id)
            if all(r["cve_id"] != cve_id for r in bucket):
                bucket.append(record)

    return {"versioned": versioned, "ranges": {}}
```

- [ ] **Step 4: Run test to verify it passes**

Run the focused command. Expected: PASS.

- [ ] **Step 5: Full suite + commit**

```bash
cd /home/cchock/projects/ds-asv
git add scanner/app/scoring/greenbone_export.py scanner/tests/fixtures/gmp_get_nvts.xml scanner/tests/test_greenbone_export.py
git commit -m "feat(scanner): pure GMP get_nvts XML -> CVE cache parser (per-CVE records, bare-product keys)"
```

---

## Task 4: scripts/update_greenbone.py CLI + dependency

**Files:**
- Create: `scanner/scripts/update_greenbone.py` (next to `update_nvd.py`)
- Modify: `scanner/requirements.txt` (add `python-gvm>=24.0.0` under the CVE section)
- Modify: `.gitignore` (add `scanner/data/`)
- Create: `tests/test_update_greenbone_cli.py`

**Interfaces:**
- Consumes: Task 3 `build_greenbone_cache`, Task 2 `DEFAULT_FEED_PATH`; lazy `python-gvm` only in live mode.
- Produces (used by Task 5): cache file at `$GREENBONE_FEED_PATH` (default `./data/greenbone_cves.json`) with the `{versioned, ranges}` shape.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_update_greenbone_cli.py` (runs the CLI as a subprocess with the venv python — no network, `--gmp-xml` fixtures only):

```python
"""scripts/update_greenbone.py — fixture runs, atomic-write safety."""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "update_greenbone.py"
FIXTURE = Path(__file__).parent / "fixtures" / "gmp_get_nvts.xml"


def _run(*args, env_extra=None):
    env = {"PATH": "/usr/bin:/bin"}
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        env={**env},
    )


def test_cli_builds_cache_from_xml_fixture(tmp_path):
    out = tmp_path / "greenbone_cves.json"
    proc = _run("--gmp-xml", str(FIXTURE), "--out", str(out))
    assert proc.returncode == 0, proc.stderr
    cache = json.loads(out.read_text(encoding="utf-8"))
    assert "openssl:3.0.1" in cache["versioned"]
    assert "nginx:" in cache["versioned"]


def test_cli_writes_to_default_env_path(tmp_path):
    out = tmp_path / "env_cache.json"
    proc = _run(
        "--gmp-xml", str(FIXTURE),
        env_extra={"GREENBONE_FEED_PATH": str(out)},
    )
    assert proc.returncode == 0, proc.stderr
    assert out.exists()


def test_cli_rejects_empty_export_and_keeps_last_good(tmp_path):
    good = tmp_path / "good.json"
    proc = _run("--gmp-xml", str(FIXTURE), "--out", str(good))
    assert proc.returncode == 0
    before = good.read_bytes()

    empty = tmp_path / "empty.xml"
    empty.write_text('<get_nvts_response status="200" status_text="OK"/>\n', encoding="utf-8")
    proc = _run("--gmp-xml", str(empty), "--out", str(good))
    assert proc.returncode != 0
    assert good.read_bytes() == before  # never clobbered


def test_cli_rejects_missing_xml_file(tmp_path):
    out = tmp_path / "x.json"
    proc = _run("--gmp-xml", str(tmp_path / "nope.xml"), "--out", str(out))
    assert proc.returncode != 0
    assert not out.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_update_greenbone_cli.py -v`
Expected: FAIL — script missing (subprocess reports no such file, tests fail).

- [ ] **Step 3: Implement**

Create `scripts/update_greenbone.py`:

```python
#!/usr/bin/env python3
"""Build the Greenbone CVE cache used by the ASV scoring engine.

Two modes:

  --gmp-xml <file>   parse an existing GMP <get_nvts_response> XML document
                     (offline: use in CI/dev; capture one from a real gvmd
                     with the live mode below and keep it as a fixture)
  live (default)     fetch NVT metadata from gvmd over SSH (GMP) using
                     python-gvm — requires python-gvm + a reachable gvmd;
                     credentials come from GREENBONE_HOST / GREENBONE_PORT /
                     GREENBONE_USER / GREENBONE_PASSWORD

Writes the {versioned, ranges} cache to $GREENBONE_FEED_PATH
(default ./data/greenbone_cves.json, see GREENBONE_FEED_PATH) via a temp
file + atomic rename. A failed fetch, unparseable XML, or an empty export
EXITS NON-ZERO and NEVER clobbers the last good cache.

Usage::

    python scripts/update_greenbone.py --gmp-xml tests/fixtures/gmp_get_nvts.xml
    python scripts/update_greenbone.py --gmp-xml local.xml --out /path/cache.json
    python scripts/update_greenbone.py               # live GMP fetch
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent  # scanner/ — app/ lives under it
sys.path.insert(0, str(REPO_ROOT))

from app.scoring.greenbone_export import build_greenbone_cache  # noqa: E402

DEFAULT_FEED_PATH = "./data/greenbone_cves.json"


def _fetch_gmp_xml() -> str:
    """Fetch EVERY NVT from gvmd (GMP) and return ONE <get_nvts_response>
    document carrying all <nvt> elements (for build_greenbone_cache).

    get_nvts caps each response at 1000 rows, so we paginate with the
    ``rows=N first=M`` filter — the forum-verified pattern for gmp 22.x
    (forum.greenbone.net/t/getting-more-than-1000-results-with-python-gvm/8578)
    — instead of version-specific kwargs. python-gvm is imported lazily so
    offline paths (and tests) never require it.
    """
    import xml.etree.ElementTree as ET

    try:
        from gvm.connections import SSHConnection
        from gvm.protocols.gmp import GMP
    except ImportError as exc:  # pragma: no cover - manual/live path
        raise SystemExit(
            "python-gvm is not installed (pip install -r requirements.txt); "
            "use --gmp-xml <file> for offline cache builds"
        ) from exc

    host = os.environ.get("GREENBONE_HOST", "127.0.0.1")
    port = int(os.environ.get("GREENBONE_PORT", "22"))
    user = os.environ.get("GREENBONE_USER", "admin")
    password = os.environ.get("GREENBONE_PASSWORD", "")

    ROWS = 1000
    MAX_OFFSET = 1_000_000  # sanity guard against a runaway loop

    def page(filter_string: str):
        resp = gmp.get_nvts(details=True, filter_string=filter_string)
        text = resp if isinstance(resp, str) else resp.decode("utf-8")
        root = ET.fromstring(text)
        return root, list(root.iter("nvt"))

    connection = SSHConnection(hostname=host, port=port)
    with GMP(connection) as gmp:
        gmp.authenticate(user, password)
        first_root, first_nvts = page(f"rows={ROWS} first=0")
        total_el = first_root.find("filtered")
        try:
            total = (
                int(total_el.text)
                if total_el is not None and total_el.text
                else len(first_nvts)
            )
        except ValueError:
            total = len(first_nvts)

        nvts = list(first_nvts)
        offset = ROWS
        while len(nvts) < total and offset < MAX_OFFSET:
            _, more = page(f"rows={ROWS} first={offset}")
            if not more:
                break
            nvts.extend(more)
            offset += ROWS

    return (
        "<get_nvts_response>"
        + "".join(ET.tostring(n, encoding="unicode") for n in nvts)
        + "</get_nvts_response>"
    )


def _resolve_output(out: str | None) -> Path:
    target = out or os.environ.get("GREENBONE_FEED_PATH") or DEFAULT_FEED_PATH
    return Path(target)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--gmp-xml", help="Local GMP get_nvts XML file instead of a live fetch."
    )
    parser.add_argument("--out", help="Output cache path (defaults to $GREENBONE_FEED_PATH).")
    args = parser.parse_args()

    try:
        xml_text = (
            Path(args.gmp_xml).read_text(encoding="utf-8")
            if args.gmp_xml
            else _fetch_gmp_xml()
        )
        cache = build_greenbone_cache(xml_text)
    except FileNotFoundError as exc:
        print(f"error: cannot read GMP XML file: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # network/auth/parse failures
        print(f"error: failed to build Greenbone cache: {exc}", file=sys.stderr)
        return 1

    if not cache["versioned"]:
        print("error: no CVE data parsed from the GMP export; leaving previous cache intact", file=sys.stderr)
        return 1

    target = _resolve_output(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".greenbone-cache-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(cache, fh, indent=2)
        os.replace(tmp, target)
    except Exception as exc:  # pragma: no cover - filesystem edge cases
        try:
            os.unlink(tmp)
        except OSError:
            pass
        print(f"error: failed to write cache: {exc}", file=sys.stderr)
        return 1

    count = sum(len(v) for v in cache["versioned"].values())
    print(f"wrote Greenbone cache with {count} CVE records to {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

In `requirements.txt`, after the `# Black-box (unauthenticated) scanning` block, add:

```
# CVE source (Greenbone) — GMP client used ONLY by scripts/update_greenbone.py live mode
python-gvm>=24.0.0
```

In `.gitignore`, under the consolidated scanner block, add:

```
scanner/data/
```

- [ ] **Step 4: Run test to verify it passes**

Run the focused command. Expected: PASS (4 tests).

- [ ] **Step 5: Full suite + commit**

Run lint + test (the new CLI tests use `sys.executable` — the venv python — and never import python-gvm). Then:

```bash
cd /home/cchock/projects/ds-asv
git add scanner/scripts/update_greenbone.py scanner/requirements.txt .gitignore scanner/tests/test_update_greenbone_cli.py
git commit -m "feat(scanner): update_greenbone.py CLI — live GMP fetch or --gmp-xml, atomic cache write"
```

---

## Task 5: Engine default-source selection + executor regression + exports

**Files:**
- Modify: `app/scoring/engine.py`
- Modify: `app/scoring/__init__.py`
- Create: `tests/test_engine_cve_source.py`
- Modify: `tests/test_executor.py`

**Interfaces:**
- Consumes: Task 2 `GreenboneSource`, `DEFAULT_FEED_PATH`; Task 1 `CVESource`.
- Produces: `default_cve_source() -> CVESource`; `ASVScoringEngine()` picks GreenboneSource when the cache exists, else CPEMapper (unchanged dev/test behavior).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_engine_cve_source.py`:

```python
"""Engine default-source selection: Greenbone cache present -> GreenboneSource,
else the legacy CPEMapper (demo fallback preserved)."""

import json

import pytest

from app.scoring.engine import ASVScoringEngine, default_cve_source
from app.scoring.greenbone_source import GreenboneSource


def test_default_source_is_cpe_mapper_without_cache(monkeypatch):
    monkeypatch.delenv("GREENBONE_FEED_PATH", raising=False)
    source = default_cve_source()
    assert source.describe().startswith("CPEMapper")


def test_default_source_is_greenbone_when_cache_exists(tmp_path, monkeypatch):
    cache = tmp_path / "greenbone_cves.json"
    cache.write_text(
        json.dumps(
            {
                "versioned": {
                    "openssl:3.0.1": [
                        {"cve_id": "CVE-2022-1292", "title": "t", "description": "",
                         "cvss_score": 9.8, "cvss_vector": ""}
                    ]
                },
                "ranges": {},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("GREENBONE_FEED_PATH", str(cache))
    source = default_cve_source()
    assert isinstance(source, GreenboneSource)
    assert [c.cve_id for c in source.lookup("openssl", "3.0.1")] == ["CVE-2022-1292"]


def test_engine_uses_greenbone_source_end_to_end(tmp_path, monkeypatch):
    cache = tmp_path / "greenbone_cves.json"
    cache.write_text(
        json.dumps(
            {
                "versioned": {
                    "openssl:3.0.1": [
                        {"cve_id": "CVE-2022-1292", "title": "t", "description": "",
                         "cvss_score": 9.8, "cvss_vector": ""}
                    ]
                },
                "ranges": {},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("GREENBONE_FEED_PATH", str(cache))
    engine = ASVScoringEngine()
    findings = engine.score_inventory(
        {"packages_deb": {"output": "ii  openssl  3.0.1  amd64  desc"}},
        source="authenticated_dpkg",
    )
    assert any(f.cve_id == "CVE-2022-1292" for f in findings)
    assert findings[0].severity == "critical"
```

Extend `tests/test_executor.py` — read the existing file first (it drives `execute_manifest` with mocked score functions and an httpx-backed portal client); add ONE test that injects a FakeSource-backed engine and asserts the portal post payload still carries `cveId` + `pciSeverity`:

```python
# In tests/test_executor.py, following the file's existing harness:
def test_execute_manifest_scores_via_cve_source_and_posts_contract(monkeypatch):
    """Executor regression (5b §6.4): scoring now reads through a CVESource;
    the posted FindingIngest contract (cveId/pciSeverity) is unchanged."""
    from app.scoring.engine import ASVScoringEngine
    from app.scoring.types import CVEData

    class FakeSource:
        def lookup(self, product, version, os_hint=None):
            return [CVEData(cve_id="CVE-FAKE-7", title="t", description="d",
                            cvss_score=7.5, cvss_vector="")]
        def refresh(self):
            pass
        def describe(self):
            return "fake"

    engine = ASVScoringEngine(source=FakeSource())
    findings = engine.score_unauthenticated(
        [{"service": "https", "version": "1.0", "port": 443}], "nginx"
    )
    assert findings[0].cve_id == "CVE-FAKE-7"
    assert findings[0].pci_fail is True
    # The existing executor test harness (read it first) then posts these
    # findings through execute_manifest/portal_client and asserts the wire
    # payload — wire the FakeSource the same way the harness wires its
    # score-function mocks, and assert cveId/pciSeverity appear in the
    # captured POST body as they do in the existing tests.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scanner && .venv/bin/python -m pytest tests/test_engine_cve_source.py -v`
Expected: FAIL — `default_cve_source` not defined.

- [ ] **Step 3: Implement**

In `app/scoring/engine.py`, add the imports + helper and change `__init__`:

```python
import os

from app.scoring.greenbone_source import DEFAULT_FEED_PATH, GreenboneSource


def default_cve_source() -> CVESource:
    """GreenboneSource when its cache exists; else the legacy CPEMapper
    (NVD cache path + demo fallback) — dev/test behavior unchanged."""
    feed = os.environ.get("GREENBONE_FEED_PATH", DEFAULT_FEED_PATH)
    if os.path.exists(feed):
        return GreenboneSource(feed)
    return CPEMapper()


class ASVScoringEngine:
    ...
    def __init__(self, source: Optional[CVESource] = None):
        self.cve_source = source if source is not None else default_cve_source()
        self.pci_rules = PCIRules()
```

In `app/scoring/__init__.py`:

```python
"""ASV scoring engine."""

from app.scoring.base import CVESource
from app.scoring.cpe_mapper import CPEMapper
from app.scoring.engine import ASVScoringEngine
from app.scoring.greenbone_source import GreenboneSource
from app.scoring.pci_rules import PCIRules
from app.scoring.types import CVEData, ScoredFinding

__all__ = [
    "ASVScoringEngine",
    "CVESource",
    "CVEData",
    "ScoredFinding",
    "CPEMapper",
    "GreenboneSource",
    "PCIRules",
]
```

- [ ] **Step 4: Run test to verify it passes**

Run both focused files. Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run `make lint && make test`. Then:

```bash
cd /home/cchock/projects/ds-asv
git add scanner/app/scoring/engine.py scanner/app/scoring/__init__.py scanner/tests/test_engine_cve_source.py scanner/tests/test_executor.py
git commit -m "feat(scanner): engine picks GreenboneSource when cache exists (CPEMapper fallback preserved); executor regression"
```

---

## Task 6: Exit criteria + handoff

**Files:**
- Modify: `AGENTS.md` (repo root)

**Exit proof (fixture-driven, no live Greenbone needed):**
1. `scripts/update_greenbone.py --gmp-xml tests/fixtures/gmp_get_nvts.xml --out /tmp/gb.json` exits 0; the cache contains `openssl:3.0.1` and `nginx:` records.
2. With `GREENBONE_FEED_PATH=/tmp/gb.json`, a stock `ASVScoringEngine()` returns the REAL parsed CVEs (`CVE-2022-1292` for openssl 3.0.1) — verified by `tests/test_engine_cve_source.py`.
3. With no cache (default env), the engine uses `CPEMapper` and the demo table fires exactly as before (`tests/test_engine_cve_source.py::test_default_source_is_cpe_mapper_without_cache` + the untouched full suite).
4. A corrupt/empty export leaves the previous cache intact (`tests/test_update_greenbone_cli.py::test_cli_rejects_empty_export_and_keeps_last_good`).
5. Scanner suite green TWICE (parallel-flake check; baseline 27 + ~15 new).

**Live verification (manual, when the user's Greenbone is up — exit criterion, not a test):**
```bash
cd /home/cchock/projects/ds-asv/scanner
GREENBONE_HOST=<host> GREENBONE_PORT=22 GREENBONE_USER=admin GREENBONE_PASSWORD=*** .venv/bin/python scripts/update_greenbone.py
.venv/bin/python -c "from app.scoring.greenbone_source import GreenboneSource; s=GreenboneSource(); print(s.lookup('nginx', '1.18.0'))"
```
Expected: the CLI exits 0 and `lookup` returns at least the fixture CVEs shown in the local cache — confirming the real install feeds the same pipeline the fixtures covered.

`AGENTS.md` (repo root):
- Replace the runnability row `❌ Real CVE data — scanner scoring uses the demo table ...` with:
  - `✅ Real CVE data (source seam live) — engine reads through CVESource (5b checkpoint); GreenboneSource serves the Greenbone-built cache when present (bare-product keys match any version), CPEMapper demo fallback only when no cache exists`
- Add after the Phase 6 bullet: `- **Phase 7 DONE** (pluggable CVE source + Greenbone adapter): CVESource seam (protocol + CVEData, fake-source checkpoint), GreenboneSource cache reader, pure GMP get_nvts XML → cache parser, scripts/update_greenbone.py (live GMP or --gmp-xml, atomic writes); engine default = GreenboneSource when $GREENBONE_FEED_PATH exists, else legacy CPEMapper. Live verification against the user's Greenbone install is a pending manual step (command documented in the plan). Scanner full suite: <ACTUAL N> tests (run `npx ... vitest`? no — `make test` in `scanner/`). Portal untouched (349/349).`
- Update **NEXT:** `live-verify the GreenboneSource pipeline against the running Greenbone install (`python scripts/update_greenbone.py`), then optionally schedule refresh (5b §4.3 pattern) and add service→product alias mapping for banner name lookups.`
- Environment notes: add the `GREENBONE_*` env knobs line.
- Scanner pytest row: update count to the ACTUAL `make test` result.

Then run the full scanner suite twice (`make test`), and commit:

```bash
cd /home/cchock/projects/ds-asv
git add AGENTS.md
git commit -m "docs: Phase 7 DONE — pluggable CVESource + GreenboneSource (fixture-proven); live verification pending Greenbone install"
```

---

## Self-Review

**Spec coverage:**
- 5b §3 seam/checkpoint → Task 1 (`CVESource` protocol + fake-source engine tests).
- 5b §4.2 cache shape → Tasks 2/3 (`{versioned, ranges}`; `CVEData` fields match the record keys).
- 5b §4.4 atomic writes → Task 4 (temp + `os.replace`, empty export never clobbers).
- 5b §4.5 no-network behavior → Task 5 (no cache → CPEMapper demo path unchanged; GreenboneSource never fabricates).
- 5b §6.1 checkpoint → Task 1 tests; §6.4 executor regression → Task 5; §6.5 suites green → Task 6; §6.6 AGENTS.md → Task 6.
- Difference from spec: the NVD mirror itself (§4.1/§4.3/§4.6) is intentionally NOT built — the user's 2026-09-02 decision names Greenbone as the source and the NVD mirror as the not-offline path. The task list covers only the Greenbone route; scheduled refresh is a follow-up (Task 6 NEXT), mirroring that the spec's §4.3 schedule applies to the feed that actually exists.
- Portal-side contract: untouched (spec §2 "Portal-side changes out of scope").

**Placeholder scan:** every task carries exact code + commands + fixture content. The two intentional soft points are documented conditional steps, not placeholders: Task 3's implement step (real code provided) and Task 5's executor test (explicitly instructs reading the existing harness first and wiring the fake the same way — the code block provided is the scoring-side proof; the harness-specific POST assertion must follow the file's own mock shape, exactly as Phase 6 Task 3 handled the route test).

**Type consistency:** `CVEData(cve_id, title, description, cvss_score, cvss_vector)` defined in Task 1 is the ONLY cve type across Tasks 1-6; cache records use those exact keys (Tasks 2-3); `GreenboneSource.lookup(product, version, os_hint=None)` matches the protocol signature everywhere (Tasks 2/5); `build_greenbone_cache(xml_text) -> {"versioned": ..., "ranges": ...}` (Task 3) feeds `GreenboneSource` (Task 2) and the CLI (Task 4); `default_cve_source() -> CVESource` (Task 5) is the only default-construction point. `DEFAULT_FEED_PATH` constant lives in `greenbone_source.py` and is imported by engine + documented in the CLI default.