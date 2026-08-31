"""Tests for app.portal_client — httpx calls to the portal."""

import httpx
import pytest

from app.portal_client import PortalClient


def _client_with(mock_transport):
    return PortalClient(
        base_url="http://portal.test",
        client=httpx.Client(transport=mock_transport),
    )


def test_post_findings_returns_count():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer m.abc"
        assert request.url.path == "/api/v1/scans/scan_1/findings"
        return httpx.Response(201, json={"count": 2})

    pc = _client_with(httpx.MockTransport(handler))
    count = pc.post_findings("m.abc", "scan_1", [{"assetId": "a"}])
    assert count == 2


def test_post_findings_raises_on_non_201():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "Invalid manifest"})

    pc = _client_with(httpx.MockTransport(handler))
    with pytest.raises(RuntimeError):
        pc.post_findings("m.abc", "scan_1", [{"assetId": "a"}])


def test_patch_status_sends_bearer_and_status():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["authorization"]
        seen["path"] = request.url.path
        seen["body"] = request.content
        return httpx.Response(200, json={})

    pc = _client_with(httpx.MockTransport(handler))
    pc.patch_scan_status("m.abc", "scan_1", "RUNNING")
    assert seen["auth"] == "Bearer m.abc"
    assert seen["path"] == "/api/v1/scans/scan_1"
    assert b"RUNNING" in seen["body"]
