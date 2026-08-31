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
