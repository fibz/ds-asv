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
            "openssl:3.0.1": [
                {
                    "cve_id": "CVE-EXACT",
                    "title": "t",
                    "description": "",
                    "cvss_score": 5.0,
                    "cvss_vector": "",
                }
            ],
            "openssl:": [
                {
                    "cve_id": "CVE-BARE",
                    "title": "t",
                    "description": "",
                    "cvss_score": 5.0,
                    "cvss_vector": "",
                }
            ],
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


def test_ranges_win_over_bare_product_key(tmp_path):
    cache = {
        "versioned": {
            "nginx:": [  # coarse product-level fallback
                {
                    "cve_id": "CVE-BARE",
                    "title": "t",
                    "description": "",
                    "cvss_score": 5.0,
                    "cvss_vector": "",
                }
            ]
        },
        "ranges": {
            "nginx": [
                {
                    "cve_id": "CVE-2021-23017",
                    "title": "t",
                    "description": "",
                    "cvss_score": 7.7,
                    "cvss_vector": "",
                    "versionStartIncluding": "0.6.18",
                    "versionEndExcluding": "1.20.1",
                }
            ]
        },
    }
    path = tmp_path / "nr.json"
    path.write_text(json.dumps(cache), encoding="utf-8")
    source = GreenboneSource(str(path))
    # 1.18.0 falls inside the range -> version-precise range wins over bare
    assert [c.cve_id for c in source.lookup("nginx", "1.18.0")] == ["CVE-2021-23017"]
    # 1.27.0 is outside the range -> bare fallback applies
    assert [c.cve_id for c in source.lookup("nginx", "1.27.0")] == ["CVE-BARE"]
