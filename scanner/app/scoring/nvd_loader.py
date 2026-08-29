"""NVD CVE feed loader and cache builder.

Parses NVD CVE JSON 1.1 feeds (or a small compatible fixture) into the cache
shape ``CPEMapper`` consumes:

    {
      "versioned": {"<product>:<version>": [ {cve}, ... ]},
      "ranges":    {"<product>": [ {cve, versionStartIncluding,
                                   versionEndExcluding}, ... ]}
    }

``versioned`` keys are exact (package, version) matches. ``ranges`` entries
capture advisory version ranges (``versionEndExcluding`` etc.) so a range hit
returns the real CVE rather than the demo lookup.

The parser is intentionally tolerant: feeds in production are multi-megabyte
zip archives; ``scripts/update_nvd.py`` downloads and unzips them before
calling :func:`build_cache_from_feed`.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger("asv.scoring.nvd")


def _parse_cpe(cpe: str) -> Optional[Dict[str, str]]:
    """Parse a cpe:2.3 string into vendor/product/version parts."""
    parts = cpe.split(":")
    # cpe:2.3:a:vendor:product:version:update:...
    if len(parts) < 6:
        return None
    vendor = parts[3]
    product = parts[4]
    version = parts[5]
    if not product:
        return None
    return {"vendor": vendor, "product": product, "version": version}


def _cve_dict(cve_id: str, entry: Dict[str, Any], base_score: float) -> Dict[str, Any]:
    return {
        "cve_id": cve_id,
        "title": cve_id,
        "description": _short_description(entry),
        "cvss_score": base_score,
        "cvss_vector": _cvss_vector(entry),
    }


def _short_description(entry: Dict[str, Any]) -> str:
    for desc in entry.get("cve", {}).get("descriptions", []) or []:
        if desc.get("lang") == "en":
            return desc.get("value", "")[:500]
    return ""


def _base_score(entry: Dict[str, Any]) -> float:
    metrics = entry.get("cve", {}).get("metrics", {}) or {}
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        if metrics.get(key):
            data = metrics[key][0].get("cvssData", {})
            return float(data.get("baseScore", 0.0))
    return 0.0


def _cvss_vector(entry: Dict[str, Any]) -> Optional[str]:
    metrics = entry.get("cve", {}).get("metrics", {}) or {}
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        if metrics.get(key):
            data = metrics[key][0].get("cvssData", {})
            return data.get("vectorString")
    return None


def build_cache_from_feed(doc: Any) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """Build a mapper cache from an NVD CVE 1.1 feed document."""
    versioned: Dict[str, List[Dict[str, Any]]] = {}
    ranges: Dict[str, List[Dict[str, Any]]] = {}

    cves = doc.get("vulnerabilities", []) if isinstance(doc, dict) else []
    # Tolerate a hand-authored fixture that lists CVE entries directly.
    if not cves and isinstance(doc, list):
        cves = doc
    elif not cves and isinstance(doc, dict) and "cve" in doc:
        cves = [doc]

    for entry in cves:
        cve_id = entry.get("cve", {}).get("id") or entry.get("id") or "CVE-UNKNOWN"
        score = (
            _base_score(entry)
            if "cve" in entry
            else float(entry.get("cvss_score", 0.0))
        )
        for node in _iter_nodes(entry):
            for match in node.get("cpeMatch", []) or []:
                parsed = _parse_cpe(match.get("criteria", ""))
                if not parsed or parsed["product"] == "*":
                    continue
                product = parsed["product"].lower()
                cve = _cve_dict(cve_id, entry, score)
                if match.get("versionEndExcluding") or match.get(
                    "versionStartIncluding"
                ):
                    cve_range = dict(cve)
                    if match.get("versionStartIncluding"):
                        cve_range["versionStartIncluding"] = match[
                            "versionStartIncluding"
                        ]
                    if match.get("versionEndExcluding"):
                        cve_range["versionEndExcluding"] = match["versionEndExcluding"]
                    ranges.setdefault(product, []).append(cve_range)
                elif parsed["version"] and parsed["version"] != "*":
                    versioned.setdefault(f"{product}:{parsed['version']}", []).append(
                        cve
                    )

    logger.info(
        "NVD feed parsed: %s exact-version entries, %s range entries",
        len(versioned),
        sum(len(v) for v in ranges.values()),
    )
    return {"versioned": versioned, "ranges": ranges}


def _iter_nodes(entry: Dict[str, Any]) -> List[Dict[str, Any]]:
    configs = entry.get("cve", {}).get("configurations", []) or []
    nodes: List[Dict[str, Any]] = []
    for config in configs:
        nodes.extend(config.get("nodes", []) or [])
    return nodes


def match_ranges(
    ranges: Dict[str, List[Dict[str, Any]]], product: str, version: str
) -> List[Dict[str, Any]]:
    """Return range CVEs whose affected range includes ``version``."""
    out: List[Dict[str, Any]] = []
    for cve in ranges.get(product.lower(), []):
        if _in_range(
            version, cve.get("versionStartIncluding"), cve.get("versionEndExcluding")
        ):
            out.append(cve)
    return out


def _version_key(v: str) -> tuple:
    parts = []
    for tok in str(v).replace("-", ".").split("."):
        num = ""
        for ch in tok:
            if ch.isdigit():
                num += ch
            else:
                break
        parts.append(int(num) if num else 0)
    return tuple(parts)


def _in_range(version: str, start: Optional[str], end: Optional[str]) -> bool:
    v = _version_key(version)
    if start and v < _version_key(start):
        return False
    if end and v >= _version_key(end):
        return False
    return True
