"""Black-box connector TLS grading — regression tests.

testssl.sh 3.x writes pretty JSON to a FILE (``--jsonfile-pretty``), not
stdout; ``_run_testssl`` must point it at a temp file and parse that back.
Verified against a real testssl.sh 3.2.4 run on this host (2026-09-02).
"""

import json
import subprocess
from unittest import mock

from app.scanners.blackbox_connector import BlackBoxScanner, _parse_testssl


def _scanner() -> BlackBoxScanner:
    return BlackBoxScanner("127.0.0.1", ports="8443")


def test_run_testssl_writes_json_to_file_and_parses_it():
    """The subprocess args pin testssl.sh's JSON output to a temp file, and
    the parsed result carries tls_version / cipher_strength for scoring."""
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        # args: [testssl.sh, --jsonfile-pretty, <path>, --warnings, off,
        #        --quiet, <endpoint>]
        assert args[0] == "testssl.sh"
        assert args[1] == "--jsonfile-pretty"
        with open(args[2], "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "scanResult": [
                        {"id": "tls_version", "version": "TLSv1.3", "finding": ""},
                        {
                            "id": "cipher_strength",
                            "score": "probably good",
                            "finding": "",
                        },
                    ]
                },
                fh,
            )
        return mock.Mock(stdout="", stderr="", returncode=0)

    with mock.patch.object(subprocess, "run", side_effect=fake_run):
        result = _scanner()._run_testssl("127.0.0.1", 8443)

    assert calls[0][2]  # a temp-file path, never the old stdout-only flags
    assert calls[0][1] == "--jsonfile-pretty"
    assert calls[0][3:] == ["--warnings", "off", "--quiet", "127.0.0.1:8443"]
    assert result == {
        "tls_version": "TLSv1.3",
        "cipher_strength": "probably good",
        "raw": [
            {"id": "tls_version", "version": "TLSv1.3", "finding": ""},
            {"id": "cipher_strength", "score": "probably good", "finding": ""},
        ],
    }


def test_run_testssl_returns_none_when_json_file_is_missing_or_empty():
    """A missing/unparseable JSON file degrades gracefully (None) instead of
    crashing the scan — the scoring engine then skips the TLS layer."""
    with mock.patch.object(
        subprocess, "run", return_value=mock.Mock(stdout="", stderr="", returncode=0)
    ):
        assert _scanner()._run_testssl("127.0.0.1", 8443) is None


def _scan_result(protocols, rating=None):
    """testssl.sh 3.2.4-shaped scanResult: one object with sections."""
    entry = {"targetHost": "127.0.0.1", "protocols": protocols}
    if rating is not None:
        entry["rating"] = rating
    return {"scanResult": [entry]}


def test_parse_3_2_4_reports_worst_offered_forbidden_protocol():
    """A server offering TLSv1.1 must report "TLSv1.1" so the PCI rule
    (PCIRules.FORBIDDEN_TLS_PROTOCOLS) fires — never the highest offered."""
    parsed = _parse_testssl(
        _scan_result(
            [
                {"id": "SSLv2", "finding": "not offered"},
                {"id": "SSLv3", "finding": "not offered"},
                {"id": "TLS1", "finding": "not offered"},
                {"id": "TLS1_1", "finding": "offered"},
                {"id": "TLS1_2", "finding": "offered"},
                {"id": "TLS1_3", "finding": "offered with final"},
            ]
        )
    )
    assert parsed["tls_version"] == "TLSv1.1"


def test_parse_3_2_4_reports_highest_offered_when_nothing_forbidden():
    parsed = _parse_testssl(
        _scan_result(
            [
                {"id": "TLS1_2", "finding": "offered"},
                {"id": "TLS1_3", "finding": "offered"},
            ]
        )
    )
    assert parsed["tls_version"] == "TLSv1.3"


def test_parse_3_2_4_unknown_when_nothing_offered_or_section_absent():
    assert _parse_testssl(_scan_result([]))["tls_version"] == "unknown"
    assert _parse_testssl({"scanResult": [{}]})["tls_version"] == "unknown"


def test_parse_3_2_4_grade_from_rating_used_as_cipher_strength():
    parsed = _parse_testssl(
        _scan_result(
            [{"id": "TLS1_3", "finding": "offered"}],
            rating=[{"id": "overall_grade", "finding": "T"}],
        )
    )
    assert parsed["cipher_strength"] == "T"
    assert parsed["tls_version"] == "TLSv1.3"


def test_parse_legacy_flat_shape_still_works():
    """The pre-3.x fixture shape (id-keyed flat findings) stays supported."""
    parsed = _parse_testssl(
        {
            "scanResult": [
                {"id": "tls_version", "version": "TLSv1.0", "finding": ""},
                {"id": "cipher_strength", "score": "probably bad", "finding": ""},
            ]
        }
    )
    assert parsed["tls_version"] == "TLSv1.0"
    assert parsed["cipher_strength"] == "probably bad"
