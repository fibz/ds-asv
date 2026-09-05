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
    assert f.severity == "critical"  # >= 9.0
    assert f.pci_fail is True  # >= PCI_FAIL_THRESHOLD 7.0
    assert f.requires_dispute is True  # confidence 0.6 < 0.8 and pci_fail
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
    assert findings[0].severity == "medium"  # 4.3 -> medium
    assert findings[0].pci_fail is False  # 4.3 < 7.0
    assert findings[0].raw_evidence["package"]["name"] == "openssl"


def test_engine_default_source_is_cpe_mapper_without_override(tmp_path, monkeypatch):
    # Existing behavior: no source passed -> legacy CPEMapper (demo fallback).
    # Hermetic: point GREENBONE_FEED_PATH at a non-existent file so a REAL
    # cache in scanner/data/ can't flip this to GreenboneSource.
    monkeypatch.setenv("GREENBONE_FEED_PATH", str(tmp_path / "no-cache.json"))
    engine = ASVScoringEngine()
    assert engine.cve_source.describe().startswith("CPEMapper")
