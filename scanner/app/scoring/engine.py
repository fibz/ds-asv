"""Core scoring engine — merges authenticated + unauthenticated findings."""

import logging
from typing import Any, Dict, List, Optional

from app.scoring.base import CVESource
from app.scoring.cpe_mapper import CPEMapper
from app.scoring.pci_rules import PCIRules
from app.scoring.types import ScoredFinding

logger = logging.getLogger("asv.scoring")


class ASVScoringEngine:
    """Evaluate findings through dual-pipeline scoring with PCI pass/fail logic."""

    PCI_FAIL_THRESHOLD = 7.0  # CVSS Base Score >= 7.0 = HIGH/CRITICAL

    # Source → confidence mapping
    CONFIDENCE_MAP = {
        "authenticated_dpkg": 1.0,
        "authenticated_rpm": 1.0,
        "authenticated_pacman": 1.0,
        "authenticated_registry": 0.95,
        "authenticated_win32_product": 0.92,
        "unauthenticated_banner": 0.60,
        "unauthenticated_probe": 0.50,
    }

    def __init__(self, source: Optional[CVESource] = None):
        self.cve_source = source if source is not None else CPEMapper()
        self.pci_rules = PCIRules()

    def score_inventory(
        self, inventory: Dict[str, Any], source: str = "authenticated_dpkg"
    ) -> List[ScoredFinding]:
        """Score a collected inventory against vulnerability databases."""
        findings = []
        confidence = self.CONFIDENCE_MAP.get(source, 0.5)

        packages = self._extract_packages(inventory)
        for pkg in packages:
            cves = self.cve_source.lookup(pkg["name"], pkg["version"], pkg.get("os"))
            for cve in cves:
                cvss = cve.cvss_score
                pci_fail = cvss >= self.PCI_FAIL_THRESHOLD

                findings.append(
                    ScoredFinding(
                        title=cve.title or f"CVE in {pkg['name']}",
                        description=cve.description,
                        cve_id=cve.cve_id or None,
                        cvss_score=cvss,
                        cvss_vector=cve.cvss_vector or None,
                        severity=self._cvss_to_severity(cvss),
                        confidence=confidence,
                        source=source,
                        pci_fail=pci_fail,
                        raw_evidence={
                            "package": pkg,
                            "cve": {
                                "cve_id": cve.cve_id,
                                "title": cve.title,
                                "cvss_score": cve.cvss_score,
                            },
                        },
                        requires_dispute=confidence < 0.8 and pci_fail,
                    )
                )

        # Check PCI-specific config issues (TLS grade, iptables, etc.)
        config_findings = self.pci_rules.evaluate_config(inventory, source, confidence)
        findings.extend(config_findings)

        return findings

    def score_unauthenticated(
        self, banner_data: List[Dict[str, Any]], service_name: str
    ) -> List[ScoredFinding]:
        """Score unauthenticated banner/service detection findings."""
        findings = []
        confidence = self.CONFIDENCE_MAP.get("unauthenticated_banner", 0.6)

        for banner in banner_data:
            cves = self.cve_source.lookup(service_name, banner.get("version") or "")
            for cve in cves:
                cvss = cve.cvss_score
                pci_fail = cvss >= self.PCI_FAIL_THRESHOLD

                findings.append(
                    ScoredFinding(
                        title=f"{service_name} — {cve.title or 'Unknown CVE'}",
                        description=cve.description,
                        cve_id=cve.cve_id or None,
                        cvss_score=cvss,
                        cvss_vector=cve.cvss_vector or None,
                        severity=self._cvss_to_severity(cvss),
                        confidence=confidence,
                        source="unauthenticated_banner",
                        pci_fail=pci_fail,
                        raw_evidence={
                            "banner": banner,
                            "cve": {
                                "cve_id": cve.cve_id,
                                "title": cve.title,
                                "cvss_score": cve.cvss_score,
                            },
                        },
                        requires_dispute=confidence < 0.8 and pci_fail,
                    )
                )

        # TLS/SSL grading
        tls_findings = self.pci_rules.evaluate_tls(banner_data, confidence)
        findings.extend(tls_findings)

        return findings

    def determine_overall_result(self, findings: List[ScoredFinding]) -> str:
        """PASS if no pci_fail findings, else FAIL."""
        if any(f.pci_fail and not f.requires_dispute for f in findings):
            return "FAIL"
        return "PASS"

    def _extract_packages(self, inventory: Dict[str, Any]) -> List[Dict[str, str]]:
        """Parse dpkg, rpm, or pacman output from inventory."""
        packages = []
        os_info = inventory.get("os_release", "")

        for key in ("packages_deb", "packages_rpm", "packages_pacman"):
            data = inventory.get(key, {})
            if not data or not data.get("output"):
                continue
            parsed = self._parse_package_output(key, data["output"])
            for p in parsed:
                p["os"] = os_info
            packages.extend(parsed)

        return packages

    @staticmethod
    def _parse_package_output(source: str, output: str) -> List[Dict[str, str]]:
        """Raw package manager text → structured list."""
        packages = []
        for line in output.strip().split("\n"):
            line = line.strip()
            if not line or line.startswith(("Desired=", "| Status=", "|/ Err?=")):
                continue
            if source == "packages_deb":
                # dpkg -l format: ii  name  version  arch  description
                parts = line.split()
                if len(parts) >= 3 and parts[0].startswith(("ii", "i ")):
                    packages.append({"name": parts[1], "version": parts[2]})
            elif source == "packages_rpm":
                # rpm -qa format: name-version-release.arch
                # Simplified — real parsing needs rpm Python bindings or regex
                if "-" in line:
                    idx = line.rfind(".")  # strip arch
                    if idx > 0:
                        line = line[:idx]
                    # naive split
                    parts = line.rsplit("-", 2)
                    if len(parts) >= 2:
                        packages.append(
                            {"name": parts[0], "version": "-".join(parts[1:])}
                        )
            elif source == "packages_pacman":
                parts = line.split()
                if len(parts) >= 2:
                    packages.append({"name": parts[0], "version": parts[1]})
        return packages

    @staticmethod
    def _cvss_to_severity(score: float) -> str:
        if score >= 9.0:
            return "critical"
        if score >= 7.0:
            return "high"
        if score >= 4.0:
            return "medium"
        if score > 0:
            return "low"
        return "info"
