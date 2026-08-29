"""PCI-compliant Scan Attestation Report (SAR) generator.

Produces a PDF report suitable for submission to acquiring banks and QSAs.
"""

import logging
import os
import tempfile
from datetime import datetime
from typing import List

from app.models.database import SessionLocal
from app.models.finding import Finding
from app.models.scan import Scan
from app.models.target import Target

logger = logging.getLogger("asv.reports")


class SARReport:
    """Build and render a PCI ASV Scan Attestation Report."""

    def __init__(self, scan_id: str, db=None):
        self.scan_id = scan_id
        self.db = db or SessionLocal()
        self.scan = self.db.query(Scan).filter(Scan.id == scan_id).first()
        if not self.scan:
            raise ValueError(f"Scan {scan_id} not found")

        self.findings = (
            self.db.query(Finding)
            .filter(Finding.scan_id == scan_id)
            .order_by(Finding.cvss_score.desc())
            .all()
        )
        self.targets = (
            self.db.query(Target)
            .filter(Target.scan_id == scan_id)
            .order_by(Target.hostname)
            .all()
        )

    def build(self) -> dict:
        """Build SAR data structure."""
        auth_findings = [
            f for f in self.findings if f.source.startswith("authenticated")
        ]
        unauth_findings = [
            f for f in self.findings if f.source.startswith("unauthenticated")
        ]
        fail_findings = [f for f in self.findings if f.pci_fail]

        return {
            "report_metadata": {
                "scan_id": self.scan_id,
                "scan_type": self.scan.scan_type,
                "customer_id": self.scan.customer_id,
                "generated_at": datetime.utcnow().isoformat(),
                "asv_name": os.environ.get("ASV_NAME", "ASV Scanner Platform"),
                "asv_certification_number": os.environ.get(
                    "ASV_CERT_NUMBER", "PENDING"
                ),
            },
            "executive_summary": {
                "overall_result": self.scan.overall_result or "PENDING",
                "total_hosts_scanned": len(self.targets),
                "total_findings": len(self.findings),
                "critical_count": len(
                    [f for f in self.findings if f.severity == "critical"]
                ),
                "high_count": len([f for f in self.findings if f.severity == "high"]),
                "medium_count": len(
                    [f for f in self.findings if f.severity == "medium"]
                ),
                "low_count": len([f for f in self.findings if f.severity == "low"]),
                "pci_failures": len(fail_findings),
            },
            "scope": [
                {
                    "hostname": t.hostname,
                    "ip_address": t.ip_address,
                    "status": t.status,
                }
                for t in self.targets
            ],
            "findings": {
                "authenticated": self._finding_details(auth_findings),
                "unauthenticated": self._finding_details(unauth_findings),
            },
            "compliance_statement": self._compliance_statement(
                self.scan.overall_result, fail_findings
            ),
        }

    def generate_pdf(self) -> str:
        """Generate PDF using WeasyPrint (or return HTML if not installed).

        Returns filesystem path to the generated PDF.
        """
        sar_data = self.build()
        html = self._render_html(sar_data)

        try:
            from weasyprint import HTML

            pdf_path = os.path.join(tempfile.gettempdir(), f"SAR-{self.scan_id}.pdf")
            HTML(string=html).write_pdf(pdf_path)
            logger.info(f"SAR PDF generated: {pdf_path}")
            return pdf_path
        except ImportError:
            logger.warning("weasyprint not installed; returning HTML only")
            html_path = os.path.join(tempfile.gettempdir(), f"SAR-{self.scan_id}.html")
            with open(html_path, "w") as f:
                f.write(html)
            return html_path

    def _finding_details(self, findings: List[Finding]) -> List[dict]:
        return [
            {
                "target": f.target.hostname if f.target else "unknown",
                "title": f.title,
                "description": f.description,
                "cve_id": f.cve_id,
                "cvss_score": float(f.cvss_score) if f.cvss_score else None,
                "severity": f.severity,
                "source": f.source,
                "pci_fail": f.pci_fail,
                "suppressed": f.is_suppressed,
                "suppression_reason": f.suppression_reason,
                "confidence": f.confidence,
            }
            for f in findings
        ]

    def _compliance_statement(
        self, overall_result: str | None, fail_findings: List[Finding]
    ) -> str:
        if overall_result == "PASS":
            return (
                "This ASV scan has been completed and demonstrates compliance "
                "with PCI DSS Requirement 11.3.2. No vulnerabilities were identified "
                "that would cause the scan to fail the PCI ASV Program pass/fail criteria."
            )
        if overall_result == "FAIL":
            details = ", ".join(
                f"{f.cve_id or f.title} on {f.target.hostname if f.target else 'unknown'}"
                for f in fail_findings[:5]
            )
            return (
                "This scan has FAILED the PCI ASV scan criteria. The following "
                "high/critical vulnerabilities were identified and must be remediated "
                f"before a passing scan can be achieved: {details}."
            )
        return "Scan result is pending final review."

    def _render_html(self, data: dict) -> str:
        """Render SAR as HTML."""
        meta = data["report_metadata"]
        summary = data["executive_summary"]

        findings_html = ""
        for section, items in data["findings"].items():
            findings_html += f"<h3>{section.title()} Findings ({len(items)})</h3>"
            if not items:
                findings_html += "<p>No findings in this category.</p>"
                continue
            findings_html += "<table><thead><tr>"
            cols = [
                "Target",
                "CVE",
                "Title",
                "CVSS",
                "Severity",
                "PCI Fail",
                "Confidence",
            ]
            for c in cols:
                findings_html += f"<th>{c}</th>"
            findings_html += "</tr></thead><tbody>"
            for f in items:
                severity_class = f"severity-{f['severity']}"
                pci_class = "pci-fail" if f["pci_fail"] else "pci-pass"
                findings_html += (
                    f"<tr class='{severity_class}'>"
                    f"<td>{f['target']}</td>"
                    f"<td>{f['cve_id'] or 'N/A'}</td>"
                    f"<td>{f['title']}</td>"
                    f"<td>{f['cvss_score']}</td>"
                    f"<td>{f['severity'].upper()}</td>"
                    f"<td class='{pci_class}'>{'YES' if f['pci_fail'] else 'NO'}</td>"
                    f"<td>{f['confidence']}</td>"
                    f"</tr>"
                )
            findings_html += "</tbody></table>"

        return (
            f"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>ASV SAR — {meta['scan_id']}</title>
<style>
  body {{ font-family: Arial, sans-serif; margin: 40px; }}
  h1 {{ color: #1a237e; }}
  h2 {{ color: #283593; border-bottom: 2px solid #c5cae9; padding-bottom: 6px; }}
  table {{ border-collapse: collapse; width: 100%; margin: 16px 0; }}
  th, td {{ border: 1px solid #c5cae9; padding: 8px; text-align: left; }}
  th {{ background: #e8eaf6; }}
  .severity-critical {{ background: #ffcdd2; }}
  .severity-high {{ background: #ffe0b2; }}
  .severity-medium {{ background: #fff9c4; }}
  .severity-low {{ background: #c8e6c9; }}
  .pci-fail {{ color: #b71c1c; font-weight: bold; }}
  .pci-pass {{ color: #1b5e20; }}
  .summary-box {{ background: #f5f5f5; padding: 20px; border-radius: 8px; }}
</style>
</head>
<body>
<h1>PCI ASV Scan Attestation Report (SAR)</h1>
<div class="summary-box">
  <p><strong>ASV:</strong> {meta['asv_name']}</p>
  <p><strong>Certification:</strong> {meta['asv_certification_number']}</p>
  <p><strong>Scan ID:</strong> {meta['scan_id']}</p>
  <p><strong>Scan Type:</strong> {meta['scan_type']}</p>
  <p><strong>Generated:</strong> {meta['generated_at']}</p>
</div>

<h2>Executive Summary</h2>
<p><strong>Overall Result: <span style="font-size:1.4em">{summary['overall_result']}</span></strong></p>
<ul>  # noqa: E501
  <li>Hosts Scanned: {summary['total_hosts_scanned']}</li>
  <li>Total Findings: {summary['total_findings']}</li>
  <li>Critical: {summary['critical_count']}</li>
  <li>High: {summary['high_count']}</li>
  <li>Medium: {summary['medium_count']}</li>
  <li>Low: {summary['low_count']}</li>
  <li>PCI Failures: {summary['pci_failures']}</li>
</ul>

<h2>Scope</h2>
<table>
<thead><tr><th>Hostname</th><th>IP Address</th><th>Status</th></tr></thead>
<tbody>
"""
            + "".join(
                f"<tr><td>{s['hostname']}</td><td>{s['ip_address'] or 'N/A'}</td><td>{s['status']}</td></tr>"  # noqa: E501
                for s in data["scope"]  # noqa: E501
            )
            + f"""
</tbody>
</table>

<h2>Findings Detail</h2>
{findings_html}

<h2>Compliance Statement</h2>
<p>{data['compliance_statement']}</p>

<h2>Disclaimer</h2>
<p>This report was generated by an automated scanning platform and does not replace
professional security assessment. Remediation of identified vulnerabilities is the
merchant's responsibility. A passing ASV scan is one component of PCI DSS compliance
and does not indicate full compliance on its own.</p>
</body>
</html>
"""
        )


def generate_sar(scan_id: str, db=None) -> str:
    """Public entry point — returns path to generated SAR document."""
    sar = SARReport(scan_id, db)
    return sar.generate_pdf()
