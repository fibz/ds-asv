"""Engine default-source selection: Greenbone cache present -> GreenboneSource,
else the legacy CPEMapper (demo fallback preserved)."""

import json

from app.scoring.engine import ASVScoringEngine, default_cve_source
from app.scoring.greenbone_source import GreenboneSource


def test_default_source_is_cpe_mapper_without_cache(tmp_path, monkeypatch):
    # Point the feed path at a non-existent file so a REAL cache in
    # scanner/data/ (gitignored, produced by live verification) never
    # flips this test to GreenboneSource.
    monkeypatch.setenv("GREENBONE_FEED_PATH", str(tmp_path / "no-cache.json"))
    source = default_cve_source()
    assert source.describe().startswith("CPEMapper")


def test_default_source_is_greenbone_when_cache_exists(tmp_path, monkeypatch):
    cache = tmp_path / "greenbone_cves.json"
    cache.write_text(
        json.dumps(
            {
                "versioned": {
                    "openssl:3.0.1": [
                        {
                            "cve_id": "CVE-2022-1292",
                            "title": "t",
                            "description": "",
                            "cvss_score": 9.8,
                            "cvss_vector": "",
                        }
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
                        {
                            "cve_id": "CVE-2022-1292",
                            "title": "t",
                            "description": "",
                            "cvss_score": 9.8,
                            "cvss_vector": "",
                        }
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
