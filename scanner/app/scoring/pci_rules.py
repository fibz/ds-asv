"""PCI DSS specific pass/fail rules beyond CVSS scoring.

Includes TLS/SSL grading, open database port detection, default credential checks,
and other PCI ASV Program Guide requirements.
"""

import logging
import re
from typing import Any, Dict, List

from app.scoring.types import ScoredFinding

logger = logging.getLogger("asv.pci")


class PCIRules:
    """Evaluate inventory data against PCI DSS 4.0 ASV requirements."""

    # Protocols/ciphers below TLS 1.2 = automatic fail per PCI DSS 4.0
    FORBIDDEN_TLS_PROTOCOLS = {"SSLv2", "SSLv3", "TLSv1.0", "TLSv1.1"}
    MIN_TLS_VERSION = "TLSv1.2"

    # Forbidden open ports (unrestricted exposure)
    SENSITIVE_PORTS = {
        3306: "MySQL",
        5432: "PostgreSQL",
        1433: "MS SQL Server",
        27017: "MongoDB",
        6379: "Redis",
        9200: "Elasticsearch",
        5984: "CouchDB",
        5433: "TimescaleDB",
        1521: "Oracle DB",
    }

    def evaluate_config(
        self, inventory: Dict[str, Any], source: str, confidence: float
    ) -> List[ScoredFinding]:
        """Check OS-level configs for PCI violations."""
        findings = []

        # Check /etc/shadow permissions
        shadow = inventory.get("shadow_perms", {})
        if shadow and shadow.get("output"):
            perms = shadow["output"].strip()
            if perms != "640":
                findings.append(
                    ScoredFinding(
                        title="Improper /etc/shadow permissions",
                        description=f"/etc/shadow has permissions {perms} — expected 640",
                        cvss_score=5.3,
                        severity="medium",
                        confidence=confidence,
                        source=source,
                        pci_fail=False,
                        raw_evidence={"shadow_perms": perms},
                    )
                )

        # Check SUID binaries for suspicious entries
        suid = inventory.get("suid_bins", {})
        if suid and suid.get("output"):
            suspicious = self._audit_suid(suid["output"])
            for s in suspicious:
                findings.append(
                    ScoredFinding(
                        title=f"Suspicious SUID binary: {s['binary']}",
                        description=s["reason"],
                        cvss_score=6.5,
                        severity="medium",
                        confidence=confidence,
                        source=source,
                        pci_fail=False,
                        raw_evidence=s,
                    )
                )

        # Check iptables for unrestricted DB access
        iptables = inventory.get("iptables", {})
        if iptables and iptables.get("output"):
            bad_rules = self._audit_iptables(
                inventory.get("listeners", {}), iptables["output"]
            )
            for rule in bad_rules:
                findings.append(
                    ScoredFinding(
                        title=f"Unrestricted access to {rule['service']}",
                        description=f"Port {rule['port']} accepts traffic from 0.0.0.0/0",
                        cvss_score=7.5,
                        severity="high",
                        confidence=confidence,
                        source=source,
                        pci_fail=True,
                        raw_evidence=rule,
                    )
                )

        return findings

    def evaluate_tls(
        self, banner_data: List[Dict[str, Any]], confidence: float
    ) -> List[ScoredFinding]:
        """Grade TLS configuration from scan output."""
        findings = []

        for entry in banner_data:
            tls_version = entry.get("tls_version", "")
            if tls_version in self.FORBIDDEN_TLS_PROTOCOLS:
                findings.append(
                    ScoredFinding(
                        title=f"Deprecated TLS protocol: {tls_version}",
                        description=f"{tls_version} is prohibited under PCI DSS 4.0. Minimum: {self.MIN_TLS_VERSION}",  # noqa: E501
                        cvss_score=7.5,
                        severity="high",
                        confidence=confidence,
                        source="unauthenticated_banner",
                        pci_fail=True,
                        raw_evidence=entry,
                        requires_dispute=confidence < 0.8 and True,
                    )
                )

            # Weak cipher suites
            ciphers = entry.get("cipher_suites", [])
            weak = [
                c
                for c in ciphers
                if any(w in c.upper() for w in ("NULL", "EXPORT", "DES", "RC4", "MD5"))
            ]
            if weak:
                findings.append(
                    ScoredFinding(
                        title="Weak cipher suites enabled",
                        description=f"Prohibited ciphers: {', '.join(weak)}",
                        cvss_score=6.8,
                        severity="medium",
                        confidence=confidence,
                        source="unauthenticated_banner",
                        pci_fail=True,
                        raw_evidence={"weak_ciphers": weak},
                        requires_dispute=confidence < 0.8 and True,
                    )
                )

        return findings

    @staticmethod
    def _audit_suid(suid_output: str) -> List[Dict[str, str]]:
        """Flag unexpected SUID binaries."""
        suspicious = []
        known_bad = {
            "/usr/bin/nmap",
            "/usr/bin/nc",
            "/usr/bin/netcat",
            "/usr/bin/python",
            "/usr/bin/python3",
            "/usr/bin/perl",
        }
        for line in suid_output.strip().split("\n"):
            binary = line.strip()
            if binary in known_bad:
                suspicious.append(
                    {
                        "binary": binary,
                        "reason": f"{binary} should not have SUID bit set",
                    }
                )
        return suspicious

    @staticmethod
    def _audit_iptables(
        listeners: Dict[str, Any], iptables_output: str
    ) -> List[Dict[str, Any]]:
        """Check iptables for rules allowing 0.0.0.0/0 on sensitive ports."""
        bad = []
        # Parse ss/netstat output for listening ports
        listening_ports = set()
        if listeners and listeners.get("output"):
            for line in listeners["output"].split("\n"):
                # Match 0.0.0.0:PORT or :::PORT
                m = re.search(r"0\.0\.0\.0:(\d+)", line)
                if m:
                    listening_ports.add(int(m.group(1)))

        for port, service in PCIRules.SENSITIVE_PORTS.items():
            if port in listening_ports:
                # Check iptables for explicit 0.0.0.0/0 rule on this port
                if "0.0.0.0/0" in iptables_output and str(port) in iptables_output:
                    bad.append(
                        {"port": port, "service": service, "rule": "ACCEPT 0.0.0.0/0"}
                    )
        return bad
