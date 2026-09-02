"""Pure GMP get_nvts XML -> cache parser (no network, no python-gvm)."""

from pathlib import Path

import pytest

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
    assert "vendor:product" not in keys  # NVT had no CVE
    assert not any(k.startswith("not-a-cpe") for k in keys)


def test_empty_response_yields_empty_cache():
    empty = '<get_nvts_response status="200" status_text="OK"/>\n'
    assert build_greenbone_cache(empty) == {"versioned": {}, "ranges": {}}


def test_malformed_xml_raises_lookup_error():
    with pytest.raises(Exception):
        build_greenbone_cache("<get_nvts_response><nvt>")


def test_cvss_falls_back_to_severities_score_attribute():
    # GMP 22.x+ NVTs carry the score on <severities score=...> — see
    # forum.greenbone.net/t/getting-more-than-1000-results-with-python-gvm/8578.
    xml = (
        "<get_nvts_response>"
        '<nvt oid="x"><name>n</name><summary>s</summary>'
        '<severities score="7.5"/>'
        "<cve>CVE-2020-0002</cve><cpe>cpe:/a:vendor:prod:1.0</cpe>"
        "</nvt></get_nvts_response>"
    )
    cache = build_greenbone_cache(xml)
    assert cache["versioned"]["prod:1.0"][0]["cvss_score"] == 7.5
