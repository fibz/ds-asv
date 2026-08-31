"""Map a scored scanner finding to the portal's FindingIngest shape."""

from __future__ import annotations

import hashlib
from typing import Optional

from app.scoring.types import ScoredFinding

_LEVELS = {
    "critical": "5",
    "high": "4",
    "medium": "3",
    "low": "2",
    "info": "1",
}

_PCI = {
    "critical": "High",
    "high": "High",
    "medium": "Medium",
    "low": "Low",
    "info": "Low",
}


def scanner_severity_to_level(severity: str) -> str:
    return _LEVELS.get(severity, "1")


def scanner_severity_to_pci(severity: str) -> Optional[str]:
    return _PCI.get(severity)


def derive_qid(cve_id: Optional[str], title: str, source: str) -> str:
    raw = f"{cve_id or ''}|{source or ''}|{title}"
    return "q:" + hashlib.sha256(raw.encode()).hexdigest()[:16]


def map_finding(asset_canonical: str, sf: ScoredFinding) -> dict:
    out = {
        "assetId": asset_canonical,
        "qid": derive_qid(sf.cve_id, sf.title, sf.source),
        "severity": scanner_severity_to_level(sf.severity),
        "title": sf.title,
        "description": sf.description or None,
        "cveId": sf.cve_id,
    }
    pci = scanner_severity_to_pci(sf.severity)
    if pci:
        out["pciSeverity"] = pci
    if sf.description:
        out["threat"] = sf.description
    return out
