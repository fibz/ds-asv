"""Greenbone-backed CVESource — reads the locally-built cache.

The cache (``$GREENBONE_FEED_PATH``, default ``./data/greenbone_cves.json``)
is written by ``scripts/update_greenbone.py`` from Greenbone's GMP
``get_nvts`` export. Same ``{versioned, ranges}`` shape as the NVD loader.

Lookup semantics:
- exact ``<product>:<version>`` hit wins;
- a bare ``<product>:`` key — an NVT whose CPE declares the product but not
  the version, the common Greenbone case — matches ANY version;
- else a ``ranges`` hit (future exporters may populate ranges);
- else ``[]`` + warning. NEVER the demo table: that fallback belongs to
  CPEMapper, which the engine uses only when no Greenbone cache exists.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from app.scoring.base import (  # noqa: F401  (protocol conformance — see class docstring)
    CVESource,
)
from app.scoring.nvd_loader import match_ranges
from app.scoring.types import CVEData

logger = logging.getLogger("asv.scoring.greenbone")

DEFAULT_FEED_PATH = "./data/greenbone_cves.json"


def _to_cve_data(record: Dict[str, Any]) -> CVEData:
    """Cache record → CVEData, tolerating extra advisory keys (e.g. the
    versionStartIncluding/versionEndExcluding carried by range records)."""
    return CVEData(
        cve_id=str(record.get("cve_id", "")),
        title=str(record.get("title", "")),
        description=str(record.get("description", "")),
        cvss_score=float(record.get("cvss_score", 0.0) or 0.0),
        cvss_vector=str(record.get("cvss_vector", "")),
    )


class GreenboneSource:
    """Cache-backed Greenbone CVESource (implements the CVESource protocol)."""

    def __init__(self, feed_path: Optional[str] = None):
        self.feed_path = (
            feed_path or os.environ.get("GREENBONE_FEED_PATH") or DEFAULT_FEED_PATH
        )
        self._versioned: Dict[str, List[Dict[str, Any]]] = {}
        self._ranges: Dict[str, List[Dict[str, Any]]] = {}
        self._load()

    def _load(self) -> None:
        if not os.path.exists(self.feed_path):
            logger.warning(
                "Greenbone cache missing at %s; lookups return []",
                self.feed_path,
            )
            return
        try:
            with open(self.feed_path, encoding="utf-8") as fh:
                cache = json.load(fh)
            self._versioned = (
                (cache.get("versioned") or {}) if isinstance(cache, dict) else {}
            )
            self._ranges = (
                (cache.get("ranges") or {}) if isinstance(cache, dict) else {}
            )
        except (OSError, ValueError) as exc:
            logger.warning("Failed to load Greenbone cache %s: %s", self.feed_path, exc)
            self._versioned = {}
            self._ranges = {}

    def lookup(
        self,
        product: str,
        version: Optional[str],
        os_hint: Optional[str] = None,
    ) -> List[CVEData]:
        product = product.lower()
        key = f"{product}:{version}"
        if key in self._versioned:
            return [_to_cve_data(r) for r in self._versioned[key]]
        if f"{product}:" in self._versioned:
            return [_to_cve_data(r) for r in self._versioned[f"{product}:"]]
        if self._ranges:
            staged = match_ranges(self._ranges, product, version or "")
            if staged:
                return [_to_cve_data(r) for r in staged]
        logger.warning("Greenbone cache miss for %s:%s", product, version)
        return []

    def refresh(self) -> None:
        """Reload the cache file (built by scripts/update_greenbone.py).
        A failed load leaves the previous buckets in place."""
        self._versioned = {}
        self._ranges = {}
        self._load()

    def describe(self) -> str:
        return f"GreenboneSource(cache={self.feed_path})"
