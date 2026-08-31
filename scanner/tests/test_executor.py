"""Tests for app.executor — end-to-end manifest execution (stubbed scanner)."""

import hmac
import json
import sys
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app import manifest
from app.executor import InvalidManifestError, execute_manifest
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
    engine = SimpleNamespace(
        score_unauthenticated=lambda banners, service: [
            ScoredFinding(
                title="Deprecated TLS",
                severity="high",
                source="unauthenticated_probe",
            )
        ]
    )
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
