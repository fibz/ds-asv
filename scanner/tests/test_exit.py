"""Phase 3b exit criteria — scanner consumes the Phase 3 manifest contract."""
import hmac
import json

import httpx

from app import manifest
from app.executor import execute_manifest
from app.finding_mapping import map_finding
from app.scoring.types import ScoredFinding


def _token():
    payload = {
        "scanId": "scan_exit",
        "organizationId": "org_exit",
        "targets": [{"type": "fqdn", "canonicalIdentifier": "web.example.com"}],
        "issuedAt": "2026-08-31T00:00:00Z",
        "expiresAt": "2030-01-01T00:00:00Z",
        "nonce": "exit",
    }
    body = manifest.deep_canonical_json(payload)
    sig = hmac.new(b"dev-manifest-secret", body.encode(), "sha256").hexdigest()
    return f"{manifest._b64url(json.dumps(payload))}.{sig}"


def test_manifest_roundtrip_and_mapping():
    token = _token()
    verified = manifest.verify_scan_manifest(token)
    assert verified is not None
    assert verified["targets"][0]["canonicalIdentifier"] == "web.example.com"
    sf = ScoredFinding(title="TLS 1.0", severity="high", source="unauthenticated_probe")
    ingested = map_finding(verified["targets"][0]["canonicalIdentifier"], sf)
    assert ingested["assetId"] == "web.example.com"
    assert ingested["severity"] == "4"
    assert set(ingested) >= {"assetId", "qid", "severity", "title"}


def test_executor_reports_to_portal_via_mock():
    from app.executor import execute_manifest
    from app.portal_client import PortalClient

    events = []

    class FakeScanner:
        def __init__(self, target):
            self.target = target

        def run(self):
            from types import SimpleNamespace
            return SimpleNamespace(status="COMPLETED", target=self.target, available=True,
                                   banners=[{"service": "https", "port": 443}], raw={})

    class FakeEngine:
        def score_unauthenticated(self, banners, service):
            return [ScoredFinding(title="X", severity="medium", source="unauthenticated_probe")]

    def handler(request: httpx.Request) -> httpx.Response:
        events.append((request.method, request.url.path))
        if request.method == "POST":
            return httpx.Response(201, json={"count": 1})
        return httpx.Response(200, json={})

    client = PortalClient(base_url="http://p.test", client=httpx.Client(transport=httpx.MockTransport(handler)))
    result = execute_manifest(_token(), scanner_factory=FakeScanner, client=client, engine=FakeEngine())
    assert result["status"] == "COMPLETED"
    assert result["findings"] == 1
    paths = [p for (_, p) in events]
    assert "/api/v1/scans/scan_exit/findings" in paths
    assert "/api/v1/scans/scan_exit" in paths
