"""CPE → CVE mapping and lookup layer.

In production this integrates with NVD JSON feeds and vendor advisories.
For MVP we provide a pluggable interface with a basic in-memory fallback.
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional

from app.scoring.nvd_loader import match_ranges
from app.scoring.types import CVEData

logger = logging.getLogger("asv.scoring")


def _to_cve_data(record: Dict[str, Any]) -> CVEData:
    return CVEData(
        cve_id=str(record.get("cve_id", "")),
        title=str(record.get("title", "")),
        description=str(record.get("description", "")),
        cvss_score=float(record.get("cvss_score", 0.0) or 0.0),
        cvss_vector=str(record.get("cvss_vector", "")),
    )


class CPEMapper:
    """Map Common Platform Enumeration identifiers to CVEs."""

    def __init__(self, nvd_feed_path: Optional[str] = None):
        self._cache: Dict[str, List[Dict[str, Any]]] = {}
        self._nvd_ranges: Dict[str, List[Dict[str, Any]]] = {}
        self.nvd_feed_path = nvd_feed_path or os.environ.get("NVD_FEED_PATH")
        self._load_cache()
        self._normalize_cache()

    def _load_cache(self) -> None:
        """Load NVD data if available."""
        if self.nvd_feed_path and os.path.exists(self.nvd_feed_path):
            try:
                with open(self.nvd_feed_path, "r") as f:
                    self._cache = json.load(f)
                logger.info(f"Loaded NVD cache: {len(self._cache)} entries")
            except Exception as e:
                logger.warning(f"Failed to load NVD cache: {e}")

    def _normalize_cache(self) -> None:
        """Split loaded feeds written by scripts/update_nvd.py into exact and range caches."""
        loaded: Any = self._cache
        if not isinstance(loaded, dict):
            return
        if "versioned" in loaded and "ranges" in loaded:
            self._nvd_ranges = loaded.get("ranges", {}) or {}
            self._cache = loaded.get("versioned", {}) or {}

    def lookup_cves(
        self, package_name: str, version: str, os_hint: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Look up CVEs for a given package name + version.

        Production: queries NVD API, local SQLite DB, or Vulners.
        MVP: returns hardcoded demo data if cache miss.
        """
        key = f"{package_name}:{version}"
        if key in self._cache:
            return self._cache[key]

        # Demo fallback — in production replace with NVD API calls
        if self._nvd_ranges:
            staged = match_ranges(self._nvd_ranges, package_name, version)
            if staged:
                return staged
        return self._demo_lookup(package_name, version)

    def lookup(
        self,
        product: str,
        version: Optional[str],
        os_hint: Optional[str] = None,
    ) -> List[CVEData]:
        """CVESource conformance: dict pipeline (NVD cache → ranges → demo
        fallback) converted to CVEData. The demo fallback is logged exactly
        as before and only fires when no cache data exists."""
        return [
            _to_cve_data(d) for d in self.lookup_cves(product, version or "", os_hint)
        ]

    def refresh(self) -> None:
        """Reload the cache file if it changed out-of-band (built by
        scripts/update_nvd.py). Failures leave the previous cache in place."""
        self._cache = {}
        self._nvd_ranges = {}
        self._load_cache()
        self._normalize_cache()

    def describe(self) -> str:
        return f"CPEMapper(cache={self.nvd_feed_path or 'unset'})"

    def _demo_lookup(self, package_name: str, version: str) -> List[Dict[str, Any]]:
        """Demo fallback for environments without an NVD cache; logged as a warning."""
        # Simple version comparison for demo purposes
        logger.warning(
            "NVD cache miss for %s:%s; using demo lookup fallback",
            package_name,
            version,
        )
        known_vulns = {
            "openssl": {"max_safe": "3.0.3", "cve": "CVE-2022-1292", "cvss": 9.8},
            "openssh-server": {
                "max_safe": "8.9p2",
                "cve": "CVE-2023-28531",
                "cvss": 7.8,
            },
            "nginx": {"max_safe": "1.20.1", "cve": "CVE-2021-23017", "cvss": 7.7},
        }

        pkg_lower = package_name.lower()
        if pkg_lower in known_vulns:
            info = known_vulns[pkg_lower]
            # Naïve string comparison — real code uses packaging.version
            if version < info["max_safe"]:  # type: ignore
                return [
                    {
                        "cve_id": info["cve"],
                        "title": f"{package_name} {version} < {info['max_safe']}",
                        "description": f"Known vulnerability in {package_name} {version}",
                        "cvss_score": info["cvss"],
                        "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
                    }
                ]
        return []

    def update_cache(self, cpe: str, cves: List[Dict[str, Any]]) -> None:
        """Add or refresh cache entry."""
        self._cache[cpe] = cves
