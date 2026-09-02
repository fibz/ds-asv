"""Pure parser: Greenbone GMP <get_nvts_response> XML -> cache dict.

No network and no python-gvm — takes the XML document (captured live by
``scripts/update_greenbone.py`` or saved with ``--gmp-xml``) and returns the
``{versioned, ranges}`` cache ``GreenboneSource`` consumes (5b spec §4.2).

An NVT contributes one cache record PER CVE when:
- ``<cve>`` holds a whitespace/comma CVE list (empty list -> NVT skipped),
- ``<cpe>`` parses as ``cpe:/a:vendor:product[:version]`` or
  ``cpe:2.3:a:vendor:product:version:...`` (unparseable -> NVT skipped),

Versioned CPE -> key ``product:version``; bare product CPE -> key
``product:`` (matches any version — the common Greenbone case). The parser
never invents data: ``cvss_score`` defaults to 0.0 and ``cvss_vector`` to ""
when the NVT does not carry them.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("asv.scoring.greenbone")

_CVE_SPLIT = re.compile(r"[\s,;]+")


def _text(nvt: ET.Element, tag: str) -> str:
    elem = nvt.find(tag)
    return (elem.text or "").strip() if elem is not None and elem.text else ""


def _cvss(nvt: ET.Element) -> float:
    """NVT base score: <cvss_base> (older GMP) or <severities score=...>
    (GMP 22.x+ — see forum.greenbone.net/t/8578). Missing/blank -> 0.0."""
    raw = _text(nvt, "cvss_base")
    if not raw:
        sev = nvt.find("severities")
        raw = sev.get("score", "") if sev is not None else ""
    try:
        return float(raw)
    except ValueError:
        return 0.0


def _parse_cpe(cpe: str) -> Optional[Tuple[str, Optional[str]]]:
    """(product_lower, version|None) from a CPE string. Never raises."""
    cpe = cpe.strip()
    if not cpe:
        return None
    if cpe.startswith("cpe:2.3:"):
        parts = cpe.split(":")
        if len(parts) < 5:
            return None
        product = parts[4]
        if not product or product in ("*", "-"):
            return None
        version = (
            parts[5] if len(parts) > 5 and parts[5] not in ("*", "-", "") else None
        )
        return product.lower(), version
    if cpe.startswith("cpe:/"):
        parts = cpe.split(":")
        if len(parts) < 4:
            return None
        product = parts[3]
        if not product:
            return None
        version = (
            parts[4] if len(parts) > 4 and parts[4] not in ("*", "-", "") else None
        )
        return product.lower(), version
    return None


def build_greenbone_cache(xml_text: str) -> Dict[str, Any]:
    """GMP get_nvts XML text -> {"versioned": {...}, "ranges": {}}."""
    root = ET.fromstring(xml_text)
    versioned: Dict[str, List[Dict[str, Any]]] = {}

    for nvt in root.iter("nvt"):
        cve_list = [
            c for c in _CVE_SPLIT.split(_text(nvt, "cve")) if c.startswith("CVE-")
        ]
        if not cve_list:
            continue
        parsed = _parse_cpe(_text(nvt, "cpe"))
        if not parsed:
            continue
        product, version = parsed
        base = {
            "title": _text(nvt, "name") or cve_list[0],
            "description": _text(nvt, "summary") or "",
            "cvss_score": _cvss(nvt),
            "cvss_vector": _text(nvt, "cvss_vector") or "",
        }
        key = f"{product}:{version}" if version else f"{product}:"
        bucket = versioned.setdefault(key, [])
        for cve_id in cve_list:
            record = dict(base, cve_id=cve_id)
            if all(r["cve_id"] != cve_id for r in bucket):
                bucket.append(record)

    return {"versioned": versioned, "ranges": {}}
