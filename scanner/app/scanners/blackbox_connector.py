"""Black-box (unauthenticated) scan connector.

Wraps real tooling -- ``nmap`` (via ``python-nmap``) for service/version
detection and ``testssl.sh`` for TLS grading -- degrading gracefully to an
explicit ``UNAVAILABLE`` result when a tool, binary, or target is not
reachable. Production code never fabricates banners: when a tool is absent or
the target does not respond, callers receive a ``ScanResult`` whose ``status``
explains why, so the scoring engine skips the missing layer instead of being
fed fabricated banners.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Dict, List, Optional

logger = logging.getLogger("asv.scanner.blackbox")

# Ports whose service banner usually indicates a TLS-speaking endpoint worth
# grading with testssl.sh.
_TLS_PORTS = {443, 465, 587, 993, 995, 8443}
_TLS_SERVICES = {
    "https",
    "ssl",
    "ssl/http",
    "ftps",
    "imaps",
    "pop3s",
    "smtps",
    "ldapssl",
}

# Run nmap with a bounded set of well-known ports by default; callers may pass
# a custom range. When the range is large enough that a ``masscan`` pre-sweep
# would help, we try masscan first and feed its open ports to nmap.
_DEFAULT_PORTS = "1-1024"


@dataclass
class ScanResult:
    """Outcome of a black-box scan run."""

    status: str
    target: str
    reason: Optional[str] = None
    banners: List[Dict] = field(default_factory=list)
    raw: Dict = field(default_factory=dict)

    @property
    def available(self) -> bool:
        return self.status == "COMPLETED"


class BlackBoxScanner:
    """Run an unauthenticated service/version + TLS scan against one host."""

    def __init__(
        self,
        target: str,
        ports: str = _DEFAULT_PORTS,
        timeout: int = 180,
        final_individual_ip: bool = False,
    ) -> None:
        if final_individual_ip:
            ipaddress.ip_address(target)
        self.target = target
        self.ports = ports
        self.timeout = timeout
        self.final_individual_ip = final_individual_ip
        self._engine = None  # lazy

    # -- public ----------------------------------------------------------
    def run(self) -> ScanResult:
        if self.final_individual_ip:
            nmap_result = self._nmap_scan(None)
            if nmap_result.status != "COMPLETED":
                return nmap_result
            banners = self._enrich_tls(nmap_result.banners)
            return ScanResult(
                status="COMPLETED",
                target=self.target,
                banners=banners,
                raw={"nmap": nmap_result.raw, "swept": False},
            )

        sweep_ports = self._masscan_sweep()
        port_arg = ",".join(str(p) for p in sweep_ports) if sweep_ports else self.ports

        nmap_result = self._nmap_scan(port_arg)
        if nmap_result.status != "COMPLETED":
            return nmap_result

        banners = nmap_result.banners
        banners = self._enrich_tls(banners)
        return ScanResult(
            status="COMPLETED",
            target=self.target,
            banners=banners,
            raw={"nmap": nmap_result.raw, "swept": bool(sweep_ports)},
        )

    # -- nmap ------------------------------------------------------------
    def _nmap_scan(self, port_arg: Optional[str]) -> ScanResult:
        try:
            import nmap  # python-nmap
        except ImportError:
            return ScanResult(
                "UNAVAILABLE", self.target, reason="python-nmap not installed"
            )

        if not shutil.which("nmap"):
            return ScanResult(
                "UNAVAILABLE", self.target, reason="nmap binary not installed"
            )

        try:
            nm = nmap.PortScanner()
            arguments = (
                "-sC -A -Pn"
                if self.final_individual_ip
                else "-sV --version-intensity 5 -T4 -Pn"
            )
            scan_kwargs = {
                "hosts": self.target,
                "arguments": arguments,
                "timeout": self.timeout,
            }
            if port_arg is not None:
                scan_kwargs["ports"] = port_arg
            nm.scan(**scan_kwargs)
        except Exception as exc:  # pragma: no cover - depends on host/tooling
            return ScanResult("UNAVAILABLE", self.target, reason=str(exc))

        hosts = nm.all_hosts()
        if not hosts:
            return ScanResult(
                "UNAVAILABLE",
                self.target,
                reason="nmap reported no hosts (target unreachable)",
            )

        host = nm[hosts[0]]
        if host.state() != "up":
            return ScanResult(
                "NO_HOST", self.target, reason="host state: " + host.state()
            )

        banners: List[Dict] = []
        for port in host.all_tcp():
            port_info = host["tcp"][port]
            state = (port_info or {}).get("state", "unknown")
            if state != "open":
                continue
            service = (port_info or {}).get("name", "unknown")
            product = (port_info or {}).get("product", "")
            version = (port_info or {}).get("version", "")
            service_version = (product + " " + version).strip() or version
            banners.append(
                {
                    "service": service,
                    "version": service_version or "unknown",
                    "port": int(port),
                }
            )
        hostnames = host.hostnames()
        return ScanResult(
            "COMPLETED",
            self.target,
            banners=banners,
            raw={
                "state": host.state(),
                "hostnames": hostnames,
                "arguments": arguments,
                "ports": port_arg,
            },
        )

    # -- masscan pre-sweep ----------------------------------------------
    def _masscan_sweep(self) -> Optional[List[int]]:
        """Fast port sweep with masscan for large port ranges.

        Returns a list of open TCP ports to feed to nmap, or ``None`` to let
        nmap scan the full range. Masscan requires ``sudo``/``setuid` + a network
        interface; when the binary is absent or the sweep is not warranted, the
        full nmap scan is used unchanged.
        """
        try:
            hi = int(str(self.ports).rsplit("-", 1)[-1])
        except (ValueError, AttributeError):
            hi = 0
        if hi <= 4000:
            return None
        if not shutil.which("masscan"):
            logger.warning("masscan not installed; falling back to full nmap scan")
            return None

        try:
            proc = subprocess.run(
                [
                    "masscan",
                    self.target,
                    "-p" + self.ports,
                    "--rate=10000",
                    "-e",
                    "eth0",
                    "--wait=3",
                ],
                capture_output=True,
                text=True,
                timeout=self.timeout,
                check=False,
            )
        except Exception as exc:  # pragma: no cover - depends on host/tooling
            logger.warning("masscan sweep failed: %s", exc)
            return None

        ports: List[int] = []
        for line in proc.stdout.splitlines():
            # Discovered open port 443/tcp on 10.0.0.5
            if "Discovered open port" not in line:
                continue
            parts = line.split()
            if len(parts) >= 4 and "/" in parts[3]:
                try:
                    ports.append(int(parts[3].split("/", 1)[0]))
                except ValueError:
                    continue
        return ports or None

    # -- testssl.sh TLS grading -----------------------------------------
    def _enrich_tls(self, banners: List[Dict]) -> List[Dict]:
        if not shutil.which("testssl.sh"):
            logger.warning("testssl.sh not installed; TLS grading skipped")
            return banners

        for banner in banners:
            port = banner.get("port")
            service = banner.get("service") or ""
            if port not in _TLS_PORTS and service not in _TLS_SERVICES:
                continue
            tls = self._run_testssl(self.target, port)
            if tls:
                banner["tls_version"] = tls.get("tls_version", "unknown")
                banner["cipher_strength"] = tls.get("cipher_strength", "unknown")
                banner["tls_raw"] = tls.get("raw", [])
        return banners

    def _run_testssl(self, target: str, port: Optional[int]) -> Optional[Dict]:
        endpoint = target if port is None else "{0}:{1}".format(target, port)
        # testssl.sh 3.x writes pretty JSON to a FILE (--jsonfile-pretty),
        # not stdout — point it at a temp file and parse that back. The
        # stdout run log is discarded (capture_output keeps it off the
        # console). Verified against testssl.sh 3.2.4 on this host.
        fd, json_path = tempfile.mkstemp(suffix=".json", prefix="testssl-")
        os.close(fd)
        try:
            subprocess.run(
                [
                    "testssl.sh",
                    "--jsonfile-pretty",
                    json_path,
                    "--warnings",
                    "off",
                    "--quiet",
                    endpoint,
                ],
                capture_output=True,
                text=True,
                timeout=self.timeout,
                check=False,
            )
        except Exception as exc:  # pragma: no cover - depends on host/tooling
            logger.warning("testssl.sh failed for %s: %s", endpoint, exc)
            return None

        try:
            with open(json_path, encoding="utf-8") as fh:
                doc = json.load(fh)
        except (ValueError, TypeError, OSError):
            logger.warning("testssl.sh produced unparseable JSON for %s", endpoint)
            return None
        finally:
            try:
                os.remove(json_path)
            except OSError:
                pass

        return _parse_testssl(doc)


def _parse_testssl(doc: object) -> Optional[Dict]:
    """Extract ``tls_version`` and ``cipher_strength`` from a testssl JSON doc.

    testssl.sh 3.x ``--jsonfile-pretty`` emits one big ``scanResult`` object
    whose sections (``protocols``, ``rating``, ...) carry the findings; older/
    fixture shapes are flat lists of id-keyed finding objects. We normalise
    both into the fields the scoring engine consumes. ``tls_version`` is the
    worst OFFERED protocol (a forbidden one wins — see
    ``PCIRules.FORBIDDEN_TLS_PROTOCOLS``), else the highest TLS version
    offered; gradients keep the fallback fixture shape working.
    """
    if isinstance(doc, dict):
        entries = doc.get("scanResult", doc.get("findings", [doc]))
        if isinstance(entries, dict):
            entries = [entries]
    elif isinstance(doc, list):
        entries = doc
    else:
        return None

    tls_version = "unknown"
    cipher_strength = "unknown"
    raw: List = []

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        raw.append(entry)
        eid = entry.get("id", "")
        finding = entry.get("finding", "")
        # testssl 3.x section shape: the scanResult object carries the
        # protocols / rating sections directly.
        if "protocols" in entry:
            tls_version = _tls_version_from_protocols(entry.get("protocols"))
        if "rating" in entry:
            grade = _grade_from_rating(entry.get("rating"))
            if grade:
                cipher_strength = grade
        # Legacy/flat shape (id-keyed finding objects). Only overwrite when a
        # non-empty value was extracted.
        legacy_tls = str(entry.get("version") or finding).strip()
        if (eid == "tls_version" or eid.startswith("protocols")) and legacy_tls:
            tls_version = legacy_tls
        legacy_cipher = str(entry.get("score") or finding).strip()
        if (eid == "cipher_strength" or eid.startswith("cipher")) and legacy_cipher:
            cipher_strength = legacy_cipher

    return {"tls_version": tls_version, "cipher_strength": cipher_strength, "raw": raw}


# testssl protocol ids → the strings PCIRules.FORBIDDEN_TLS_PROTOCOLS matches
# exactly (testssl reports the TLS 1.0 family as "TLS1").
_TLS_PROTOCOL_NAME = {
    "TLS1": "TLSv1.0",
    "TLS1_0": "TLSv1.0",
    "TLS1_1": "TLSv1.1",
    "TLS1_2": "TLSv1.2",
    "TLS1_3": "TLSv1.3",
}
_FORBIDDEN_TLS_ORDER = ("SSLv2", "SSLv3", "TLSv1.0", "TLSv1.1")


def _tls_version_from_protocols(protocols: object) -> str:
    """Worst OFFERED protocol from a testssl ``protocols`` section.

    A forbidden protocol that is offered must be REPORTED (so the PCI rule
    fires); when none is, report the highest TLS version offered. Anything
    else, or absent, is "unknown" — never a fabricated value.
    """
    if not isinstance(protocols, list):
        return "unknown"
    offered: List[str] = []
    for proto in protocols:
        if not isinstance(proto, dict):
            continue
        pid = proto.get("id", "")
        finding = str(proto.get("finding", ""))
        if not finding.startswith("offered"):
            continue
        offered.append(_TLS_PROTOCOL_NAME.get(pid, pid))
    if not offered:
        return "unknown"
    for bad in _FORBIDDEN_TLS_ORDER:
        if bad in offered:
            return bad
    for high in ("TLSv1.3", "TLSv1.2", "TLSv1.1", "TLSv1.0"):
        if high in offered:
            return high
    return offered[-1]


def _grade_from_rating(rating: object) -> str:
    """testssl's overall SSL rating grade ("A", "T", ...) from the rating
    section — the closest factual analogue of the old ``cipher_strength``."""
    if not isinstance(rating, list):
        return ""
    for entry in rating:
        if isinstance(entry, dict) and entry.get("id") == "overall_grade":
            return str(entry.get("finding", "")).strip()
    return ""
