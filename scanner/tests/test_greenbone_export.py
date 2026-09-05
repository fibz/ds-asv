"""Pure GMP get_nvts XML -> cache parser (no network, no python-gvm)."""

from pathlib import Path

import pytest

from app.scoring.greenbone_export import (
    build_greenbone_cache,
    build_greenbone_cache_from_tsv,
    build_greenbone_cache_ranges_from_tsv,
)

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


TSV = (
    "OpenSSL 3.0.1 advisory\tCVE-2022-1292\t9.8\tcpe:/a:openssl:openssl:3.0.1\n"
    "nginx advisory\tCVE-2021-23017, CVE-2022-41741\t7.7\tcpe:/a:nginx:nginx\n"
    "openssl advisory\tCVE-2022-1292\t9.8\tcpe:/a:openssl:openssl\n"
    "heartbleed\tCVE-2014-0160\t7.5\tcpe:2.3:a:openssl:openssl:*:*:*:*:*:*:*\n"
    "no cve row\t  \t5.0\tcpe:/a:vendor:product\n"
    "no cpe row\tCVE-2020-0001\t5.0\tgarbage-not-a-cpe\n"
)


def test_tsv_builds_product_level_entries_only():
    cache = build_greenbone_cache_from_tsv(TSV)
    versioned = cache["versioned"]
    assert cache["ranges"] == {}
    # version-precise cpe rows are skipped — ranges carry version accuracy
    assert "openssl:3.0.1" not in versioned
    assert set(versioned.keys()) == {"nginx:", "openssl:"}
    assert [c["cve_id"] for c in versioned["nginx:"]] == [
        "CVE-2021-23017",
        "CVE-2022-41741",
    ]
    assert [c["cve_id"] for c in versioned["openssl:"]] == [
        "CVE-2022-1292",
        "CVE-2014-0160",
    ]
    assert versioned["openssl:"][0]["cvss_score"] == 9.8
    # rows without a CVE list or with an unparseable CPE are skipped
    assert "vendor:product" not in versioned
    assert not any(k.startswith("garbage") for k in versioned)


def test_tsv_empty_yields_empty_cache():
    assert build_greenbone_cache_from_tsv("") == {"versioned": {}, "ranges": {}}


RANGES_TSV = (
    "cpe:/a:f5:nginx\tCVE-2021-23017\t0.6.18\t\\N\t\\N\t1.20.1\t7.7\n"
    "cpe:/a:openssl:openssl\tCVE-2022-1292\t1.0.2\t\\N\t\\N\t3.0.2\t9.8\n"
    "cpe:/a:vendor:prod\tCVE-START-EXCL\t\\N\t0.5.0\t\\N\t1.0.0\t5.0\n"
    "cpe:/a:vendor:prod\tCVE-END-INCL\t1.0.0\t\\N\t2.0.0\t\\N\t5.0\n"
    "not-a-cpe\tCVE-UNPARSEABLE\t1.0.0\t\\N\t\\N\t2.0.0\t5.0\n"
)


def test_ranges_tsv_builds_range_buckets():
    ranges = build_greenbone_cache_ranges_from_tsv(RANGES_TSV)
    assert [r["cve_id"] for r in ranges["nginx"]] == ["CVE-2021-23017"]
    nginx = ranges["nginx"][0]
    assert nginx["versionStartIncluding"] == "0.6.18"
    assert nginx["versionEndExcluding"] == "1.20.1"
    assert nginx["cvss_score"] == 7.7
    assert [r["cve_id"] for r in ranges["openssl"]] == ["CVE-2022-1292"]
    # start-exclusive / end-inclusive rows can't be expressed by the cache's
    # _in_range (startIncluding/endExcluding only) -> skipped, never guessed
    assert "prod" not in ranges
    # unparseable criteria -> skipped
    assert "not-a-cpe" not in ranges


def test_ranges_tsv_empty_yields_empty():
    assert build_greenbone_cache_ranges_from_tsv("") == {}
