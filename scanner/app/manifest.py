"""Verify the Phase 3 scan-job manifest.

The portal issues a signed, expiring manifest (``issueScanManifest``); the
scanner consumes it. This module is the scanner-side verifier: it recomputes
the HMAC-SHA256 signature over a DEEP-canonicalized JSON payload, checks
expiry, and parses the target snapshot. It never logs a full manifest.
"""

from __future__ import annotations

import base64
import hmac
import json
import os
from typing import Any, Optional

MANIFEST_TTL_MS = 15 * 60 * 1000
_DEV_SECRET = "dev-manifest-secret"


def manifest_secret() -> str:
    """Return the HMAC secret; fail-closed in prod when unset."""
    if os.environ.get("APP_MODE") == "prod" and not os.environ.get("MANIFEST_SECRET"):
        raise RuntimeError("MANIFEST_SECRET is required when APP_MODE=prod")
    return os.environ.get("MANIFEST_SECRET") or _DEV_SECRET


def _b64url(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode()
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64decode(data: str) -> str:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad).decode()


def deep_canonical_json(payload: dict) -> str:
    """Serialize with object keys recursively sorted, arrays preserved."""

    def _sort(value: Any) -> Any:
        if isinstance(value, dict):
            return {k: _sort(value[k]) for k in sorted(value)}
        if isinstance(value, list):
            return [_sort(v) for v in value]
        return value

    return json.dumps(_sort(payload), separators=(",", ":"), sort_keys=False)


def _signature(payload: dict) -> str:
    body = deep_canonical_json(payload)
    return hmac.new(manifest_secret().encode(), body.encode(), "sha256").hexdigest()


def verify_scan_manifest(token: str) -> Optional[dict]:
    """Verify a manifest token. Returns the payload dict or None (never raises)."""
    if not isinstance(token, str):
        return None
    try:
        dot = token.index(".")
        if dot < 1:
            return None
        payload_b64 = token[:dot]
        sig = token[dot + 1 :]
        payload = json.loads(_b64decode(payload_b64))
        if not isinstance(payload, dict):
            return None
        expected = _signature(payload)
        actual = sig
        if not hmac.compare_digest(expected, actual):
            return None
        expires_at = payload.get("expiresAt")
        if not isinstance(expires_at, str):
            return None
        import datetime

        try:
            expiry = datetime.datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except ValueError:
            return None
        if (
            expiry.timestamp()
            <= datetime.datetime.now(datetime.timezone.utc).timestamp()
        ):
            return None
        for field in ("scanId", "organizationId"):
            if not isinstance(payload.get(field), str):
                return None
        if not isinstance(payload.get("targets"), list):
            return None
        return payload
    except Exception:
        return None
