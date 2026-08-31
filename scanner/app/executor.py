"""Thin scan executor — consume a manifest, run the scan, report findings.

Control plane owns orchestration; this module is the scanner-side executor. It
verifies a manifest, runs a black-box scan per target, maps scored findings to
the portal's FindingIngest shape, posts them, and updates the portal lifecycle.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

from app.finding_mapping import map_finding
from app.manifest import verify_scan_manifest
from app.portal_client import PortalClient
from app.scanners.blackbox_connector import BlackBoxScanner
from app.scoring.engine import ASVScoringEngine

logger = logging.getLogger("asv.executor")

RUNNING = "RUNNING"
COMPLETED = "COMPLETED"
FAILED = "FAILED"


class InvalidManifestError(Exception):
    pass


def execute_manifest(
    token: str,
    *,
    scanner_factory: Optional[Callable[[str], object]] = None,
    client: Optional[PortalClient] = None,
    engine: Optional[ASVScoringEngine] = None,
) -> dict:
    """Run one scan from a signed manifest. Returns {status, findings}."""
    verified = verify_scan_manifest(token)
    if not verified:
        raise InvalidManifestError("invalid or expired manifest")
    scan_id = verified["scanId"]
    targets = verified["targets"]
    scanner_factory = scanner_factory or (lambda t: BlackBoxScanner(t))
    engine = engine or ASVScoringEngine()
    own_client = client is None
    client = client or PortalClient()

    client.patch_scan_status(token, scan_id, RUNNING)
    all_findings: list[dict] = []
    seen_qids: set[str] = set()
    try:
        for target in targets:
            canonical = target["canonicalIdentifier"]
            scanner = scanner_factory(canonical)
            result = scanner.run()
            if not getattr(result, "available", False):
                logger.warning("scan unavailable for %s: %s", canonical, result)
                continue
            banners = getattr(result, "banners", [])
            by_service: dict = {}
            for banner in banners:
                svc = banner.get("service", "unknown")
                by_service.setdefault(svc, []).append(banner)
            for service, svc_banners in by_service.items():
                scored = engine.score_unauthenticated(svc_banners, service)
                for sf in scored:
                    ingested = map_finding(canonical, sf)
                    qid = ingested["qid"]
                    if qid in seen_qids:
                        continue
                    seen_qids.add(qid)
                    all_findings.append(ingested)
        count = client.post_findings(token, scan_id, all_findings)
        client.patch_scan_status(token, scan_id, COMPLETED)
        return {"status": COMPLETED, "findings": count}
    except Exception as exc:
        logger.exception("scan %s failed", scan_id)
        try:
            client.patch_scan_status(token, scan_id, FAILED)
        except Exception:
            pass
        raise
    finally:
        if own_client:
            client.close()
