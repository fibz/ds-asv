"""Tests for the inbound dispatch route."""

from fastapi.testclient import TestClient

from app.api.main import create_app


def test_manifest_route_accepts_valid():
    import hmac
    import json
    from unittest.mock import patch

    from app import manifest

    payload = {
        "scanId": "scan_1",
        "organizationId": "org_1",
        "targets": [{"type": "ipv4", "canonicalIdentifier": "10.1.1.1"}],
        "issuedAt": "2026-08-31T00:00:00Z",
        "expiresAt": "2030-01-01T00:00:00Z",
        "nonce": "x",
    }
    body = manifest.deep_canonical_json(payload)
    sig = hmac.new(b"dev-manifest-secret", body.encode(), "sha256").hexdigest()
    token = f"{manifest._b64url(json.dumps(payload))}.{sig}"

    with patch(
        "app.api.manifest_routes.execute_manifest",
        return_value={"status": "COMPLETED", "findings": 0},
    ):
        client = TestClient(create_app())
        resp = client.post("/v1/manifests", json={"manifest": token})
    assert resp.status_code == 202
    assert resp.json()["status"] == "accepted"


def test_manifest_route_rejects_missing():
    client = TestClient(create_app())
    resp = client.post("/v1/manifests", json={})
    assert resp.status_code == 400
