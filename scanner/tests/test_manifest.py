"""Tests for app.manifest — verify a Phase 3 scan-job manifest."""
import datetime as _dt
import hmac
import json

import pytest

from app import manifest


def _future_iso(minutes: int = 15) -> str:
    return (
        _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(minutes=minutes)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")


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
        # Future expiry computed at runtime so the "valid" manifest is never
        # rejected as expired regardless of when the suite runs. The original
        # brief hardcoded 2026-08-31T00:15:00Z, which is in the past for any
        # clock past that instant (the environment is already past it).
        "expiresAt": _future_iso(),
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
