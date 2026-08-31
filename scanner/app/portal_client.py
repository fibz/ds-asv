"""HTTP client for writing findings + lifecycle back to the portal.

The portal's ingestion route authenticates with ``Authorization: Bearer
<manifest>``. This client is deliberately thin: it posts findings and patches
scan status only.
"""

from __future__ import annotations

import os
from typing import Optional

import httpx


def portal_base_url() -> str:
    return os.environ.get("PORTAL_BASE_URL", "http://localhost:3000")


class PortalClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        client: Optional[httpx.Client] = None,
    ) -> None:
        self.base_url = (base_url or portal_base_url()).rstrip("/")
        self._client = client or httpx.Client(timeout=30)

    def close(self) -> None:
        self._client.close()

    def post_findings(
        self, manifest_token: str, scan_id: str, findings: list[dict]
    ) -> int:
        url = f"{self.base_url}/api/v1/scans/{scan_id}/findings"
        headers = {"Authorization": f"Bearer {manifest_token}"}
        try:
            resp = self._client.post(url, json={"findings": findings}, headers=headers)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"portal findings request failed: {exc}") from exc
        if resp.status_code != 201:
            raise RuntimeError(
                f"portal findings request failed: HTTP {resp.status_code}"
            )
        data = resp.json()
        return int(data.get("count", 0))

    def patch_scan_status(
        self, manifest_token: str, scan_id: str, status: str
    ) -> None:
        url = f"{self.base_url}/api/v1/scans/{scan_id}"
        headers = {"Authorization": f"Bearer {manifest_token}"}
        try:
            resp = self._client.patch(url, json={"status": status}, headers=headers)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"portal status update failed: {exc}") from exc
        if resp.status_code not in (200, 204):
            raise RuntimeError(f"portal status update failed: HTTP {resp.status_code}")
