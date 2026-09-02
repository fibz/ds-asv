"""Shared scoring types — separated to avoid circular imports."""

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class CVEData:
    """One CVE record returned by a CVESource (Greenbone, NVD, ...)."""

    cve_id: str
    title: str = ""
    description: str = ""
    cvss_score: float = 0.0
    cvss_vector: str = ""


@dataclass
class ScoredFinding:
    title: str
    description: str = ""
    cve_id: Optional[str] = None
    cvss_score: float = 0.0
    cvss_vector: Optional[str] = None
    severity: str = "info"
    confidence: float = 0.0
    source: str = ""
    pci_fail: bool = False
    raw_evidence: Dict[str, Any] = field(default_factory=dict)
    requires_dispute: bool = False
