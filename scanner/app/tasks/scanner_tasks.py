"""Celery tasks — orchestrate authenticated and unauthenticated scans."""

import ipaddress
import json
import logging
import os
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.database import SessionLocal
from app.models.evidence import Evidence
from app.models.finding import Finding, FindingConfidence
from app.models.scan import Scan, ScanStatus, ScanType
from app.models.target import Target, TargetStatus
from app.reports.storage import EvidenceVault
from app.scanners.blackbox_connector import BlackBoxScanner, ScanResult
from app.scanners.ssh_connector import SSHAuthScanner, SSHCredentials
from app.scanners.vault_ssh import VaultSSHProvider
from app.scanners.winrm_connector import WinRMAuthScanner
from app.scoring.engine import ASVScoringEngine
from app.tasks.celery_app import celery_app

logger = logging.getLogger("asv.tasks")
engine = ASVScoringEngine()
_evidence_vault: EvidenceVault | None = None


def _get_evidence_vault() -> EvidenceVault:
    global _evidence_vault
    if _evidence_vault is None:
        _evidence_vault = EvidenceVault()
    return _evidence_vault


def _get_db() -> Session:
    return SessionLocal()


def _update_scan_status(scan_id: str, status: str, error: str | None = None) -> None:
    db = _get_db()
    try:
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if scan:
            scan.status = status
            if status == ScanStatus.RUNNING and not scan.started_at:
                scan.started_at = datetime.utcnow()
            if status in (ScanStatus.COMPLETED, ScanStatus.FAILED, ScanStatus.PARTIAL):
                scan.completed_at = datetime.utcnow()
            if error:
                scan.error_message = error
            db.commit()
    finally:
        db.close()


def _update_target_status(
    target_id: str, status: str, error: str | None = None, inventory: dict | None = None
) -> None:
    db = _get_db()
    try:
        target = db.query(Target).filter(Target.id == target_id).first()
        if target:
            target.status = status
            target.completed_at = datetime.utcnow()
            if error:
                target.error_message = error
            if inventory:
                target.inventory = json.dumps(inventory, default=str)
            db.commit()
            # After updating target, check if parent scan can be finalized
            if status in (
                TargetStatus.COMPLETED,
                TargetStatus.FAILED,
                TargetStatus.SKIPPED,
            ):
                _check_and_finalize_scan(target.scan_id)
    finally:
        db.close()


def _check_and_finalize_scan(scan_id: str) -> None:
    """Check if all targets for a scan are terminal; if so, finalize the scan."""
    db = _get_db()
    try:
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if not scan:
            return

        targets = scan.targets
        if not targets:
            return

        # Check if all targets are in a terminal state
        terminal_statuses = {
            TargetStatus.COMPLETED,
            TargetStatus.FAILED,
            TargetStatus.SKIPPED,
        }
        if all(t.status in terminal_statuses for t in targets):
            # Aggregate findings across all targets
            all_findings = []
            for t in targets:
                all_findings.extend(
                    db.query(Finding).filter(Finding.target_id == t.id).all()
                )

            # Compute overall result
            scan.overall_result = (
                "FAIL"
                if any(f.pci_fail and not f.is_suppressed for f in all_findings)
                else "PASS"
            )
            scan.status = ScanStatus.COMPLETED
            scan.completed_at = datetime.utcnow()
            db.commit()
            logger.info(
                f"Scan {scan_id} finalized with overall_result={scan.overall_result}"
            )
    finally:
        db.close()


def _store_findings(
    scan_id: str, target_id: str, scored_findings: list, source: str
) -> None:
    db = _get_db()
    try:
        for sf in scored_findings:
            f = Finding(
                scan_id=scan_id,
                target_id=target_id,
                cve_id=sf.cve_id,
                title=sf.title,
                description=sf.description,
                severity=sf.severity,
                cvss_score=sf.cvss_score,
                cvss_vector=sf.cvss_vector,
                confidence=(
                    FindingConfidence.AUTHENTICATED
                    if sf.confidence >= 0.9
                    else FindingConfidence.UNCERTAIN
                ),
                source=source,
                pci_fail=sf.pci_fail,
                raw_evidence=json.dumps(sf.raw_evidence, default=str),
            )
            db.add(f)
        db.commit()
    finally:
        db.close()


def _store_evidence(
    scan_id: str, target_id: str | None, evidence_type: str, data: dict
) -> str:
    """Persist raw evidence to MinIO/S3. Returns object key."""
    cust_id = "unknown"
    try:
        db = _get_db()
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if scan:
            cust_id = scan.customer_id
        db.close()
    except Exception:
        pass

    vault = _get_evidence_vault()
    result = vault.store(
        customer_id=cust_id,
        scan_id=scan_id,
        evidence_type=evidence_type,
        data=data,
    )

    # Log evidence reference in DB
    db = _get_db()
    try:
        ev = Evidence(
            scan_id=scan_id,
            target_id=target_id,
            object_key=result["object_key"],
            bucket=result["bucket"],
            content_sha256=result["sha256"],
            evidence_type=evidence_type,
            metadata_json=json.dumps(result, default=str),
        )
        db.add(ev)
        db.commit()
    finally:
        db.close()

    return result["object_key"]


# ---------------------------------------------------------------------------
# Celery tasks (wired as plain functions for flexibility during early dev)
# In production these use @celery_app.task(bind=True, max_retries=3)
# ---------------------------------------------------------------------------


@celery_app.task(max_retries=3, name="app.tasks.scanner_tasks.run_ssh_auth_scan")
def run_ssh_auth_scan(scan_id: str, target_id: str) -> dict:
    """Execute authenticated SSH scan against a single target."""
    db = _get_db()
    try:
        target = db.query(Target).filter(Target.id == target_id).first()
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if not target or not scan:
            raise ValueError("Target or scan not found")

        hostname = target.hostname
        db.close()
    except Exception:
        db.close()
        raise

    _update_scan_status(scan_id, ScanStatus.RUNNING)
    _update_target_status(target_id, TargetStatus.RUNNING)

    try:
        vault = VaultSSHProvider(
            vault_addr=os.environ["VAULT_ADDR"],
            vault_token=os.environ["VAULT_TOKEN"],
        )
        creds_dict = vault.get_credentials(hostname)

        creds = SSHCredentials(
            username=creds_dict["username"],
            private_key=creds_dict["private_key"],
            signed_cert=creds_dict.get("signed_cert"),
            known_hosts_fingerprint=creds_dict["known_hosts_fingerprint"],
        )

        with SSHAuthScanner(hostname, target_port=target.port or 22) as scanner:
            scanner.connect(creds)
            priv_info = scanner.validate_privilege_level()
            inventory = scanner.collect_inventory()

        # Score findings
        findings = engine.score_inventory(inventory, source="authenticated_dpkg")

        # Persist
        _store_evidence(scan_id, target_id, "inventory", inventory)
        _store_evidence(scan_id, target_id, "findings", [f.__dict__ for f in findings])  # type: ignore  # noqa: E501
        _store_findings(scan_id, target_id, findings, "authenticated_dpkg")
        _update_target_status(target_id, TargetStatus.COMPLETED, inventory=inventory)

        return {
            "status": "SUCCESS",
            "target": hostname,
            "privilege_validation": priv_info,
            "findings_count": len(findings),
        }

    except Exception as exc:
        logger.exception(f"SSH auth scan failed for {hostname}")
        _update_target_status(target_id, TargetStatus.FAILED, error=str(exc))
        raise


@celery_app.task(max_retries=3, name="app.tasks.scanner_tasks.run_winrm_auth_scan")
def run_winrm_auth_scan(scan_id: str, target_id: str) -> dict:
    """Execute authenticated WinRM scan against a single target."""
    db = _get_db()
    try:
        target = db.query(Target).filter(Target.id == target_id).first()
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if not target or not scan:
            raise ValueError("Target or scan not found")

        hostname = target.hostname
        db.close()
    except Exception:
        db.close()
        raise

    _update_scan_status(scan_id, ScanStatus.RUNNING)
    _update_target_status(target_id, TargetStatus.RUNNING)

    try:
        # Read WinRM creds from Vault or environment (MVP)
        username = os.environ.get("WINRM_USERNAME", "ASVScanner")
        password = os.environ["WINRM_PASSWORD"]

        with WinRMAuthScanner(hostname) as scanner:
            scanner.connect(username, password)
            acct_info = scanner.validate_account()
            inventory = scanner.collect_inventory()

        # Score findings
        findings = engine.score_inventory(
            inventory, source="authenticated_win32_product"
        )

        _store_evidence(scan_id, target_id, "inventory", inventory)
        _store_evidence(scan_id, target_id, "findings", [f.__dict__ for f in findings])  # type: ignore  # noqa: E501
        _store_findings(scan_id, target_id, findings, "authenticated_win32_product")
        _update_target_status(target_id, TargetStatus.COMPLETED, inventory=inventory)

        return {
            "status": "SUCCESS",
            "target": hostname,
            "account_validation": acct_info,
            "findings_count": len(findings),
        }

    except Exception as exc:
        logger.exception(f"WinRM auth scan failed for {hostname}")
        _update_target_status(target_id, TargetStatus.FAILED, error=str(exc))
        raise


@celery_app.task(max_retries=3, name="app.tasks.scanner_tasks.run_blackbox_scan")
def run_blackbox_scan(scan_id: str, target_id: str) -> dict:
    """Execute an unauthenticated (black-box) scan against a single target.

    Runs ``BlackBoxScanner`` (nmap service/version detection + testssl.sh TLS
    grading) and feeds the resulting banners into ``score_unauthenticated``.
    When the tooling or target is unavailable the scan degrades gracefully and
    records the reason rather than fabricating banners.
    """
    db = _get_db()
    try:
        target = db.query(Target).filter(Target.id == target_id).first()
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if not target or not scan:
            raise ValueError("Target/scan not found")
        hostname = target.hostname
        db.close()
    except Exception:
        db.close()
        raise

    _update_scan_status(scan_id, ScanStatus.RUNNING)
    _update_target_status(target_id, TargetStatus.RUNNING)

    try:
        ports = str(target.port) if target.port else "1-1024"
        try:
            ipaddress.ip_address(hostname)
            target_is_ip = True
        except ValueError:
            target_is_ip = False
        final_individual_ip = not target.port and target_is_ip
        # 600s: testssl.sh's full profile routinely exceeds 180s per endpoint
        # (measured ~228s against 127.0.0.1 with testssl.sh 3.2.4); the old
        # 180s budget silently killed TLS grading on slow targets.
        scanner = BlackBoxScanner(
            hostname,
            ports=ports,
            timeout=600,
            final_individual_ip=final_individual_ip,
        )
        result: ScanResult = scanner.run()

        if not result.available:
            logger.warning(
                "Black-box scan %s unavailable for %s: %s",
                scan_id,
                hostname,
                result.reason,
            )
            _store_evidence(
                scan_id,
                target_id,
                "blackbox_scan",
                {"status": result.status, "reason": result.reason},
            )
            _update_target_status(
                target_id,
                TargetStatus.COMPLETED,
                error=result.reason or "black-box scan unavailable",
                inventory={"status": result.status, "reason": result.reason},
            )
            return {
                "status": "UNAVAILABLE",
                "target": hostname,
                "reason": result.reason,
                "findings_count": 0,
            }

        banner_data = result.banners

        # Group banners by service so each service is scored with its own
        # banners (and its own TLS layer) rather than cross-contaminating.
        by_service: dict = {}
        for banner in banner_data:
            svc = banner.get("service", "unknown")
            by_service.setdefault(svc, []).append(banner)

        findings = []
        engine = ASVScoringEngine()
        for service, banners in by_service.items():
            findings.extend(engine.score_unauthenticated(banners, service))

        overall = engine.determine_overall_result(findings)

        _store_evidence(
            scan_id,
            target_id,
            "banner_grab",
            {"banners": banner_data, "hostnames": result.raw.get("hostnames", [])},
        )
        _store_evidence(
            scan_id,
            target_id,
            "findings",
            [f.__dict__ for f in findings],  # type: ignore[arg-type]
        )
        _store_findings(scan_id, target_id, findings, "unauthenticated_probe")
        _update_target_status(
            target_id,
            TargetStatus.COMPLETED,
            inventory={"banners": banner_data, "overall_result": overall},
        )

        return {
            "status": "SUCCESS",
            "target": hostname,
            "findings_count": len(findings),
            "overall_result": overall,
        }

    except Exception as exc:
        logger.exception("Black-box scan failed %s", hostname)
        _update_target_status(target_id, TargetStatus.FAILED, error=str(exc))
        raise


@celery_app.task(name="app.tasks.scanner_tasks.run_quarterly_rescan")
def run_quarterly_rescan() -> dict:
    """PCI DSS 11.3.2 quarterly rescan sweep.

    For every customer, if the latest scan is older than 90 days (or none
    exists), enqueue a fresh quarterly scan mirroring that customer's previous
    targets. Run by the Celery beat scheduler (see app.tasks.celery_app).
    """
    from datetime import datetime, timedelta

    from app.models.customer import Customer

    db = _get_db()
    try:
        cutoff = datetime.utcnow() - timedelta(days=90)
        customers = db.query(Customer).all()
        enqueued = 0
        for customer in customers:
            latest = (
                db.query(Scan)
                .filter(Scan.customer_id == customer.id)
                .order_by(Scan.created_at.desc())
                .first()
            )
            if latest and latest.created_at and latest.created_at > cutoff:
                continue

            new_scan = Scan(customer_id=customer.id, scan_type=ScanType.QUARTERLY)
            db.add(new_scan)
            db.flush()

            prior_targets = (
                (db.query(Target).filter(Target.scan_id == latest.id).all())
                if latest
                else []
            )
            for prior in prior_targets:
                db.add(
                    Target(
                        scan_id=new_scan.id,
                        hostname=prior.hostname,
                        ip_address=prior.ip_address,
                        port=prior.port,
                        auth_method=prior.auth_method,
                        status=TargetStatus.PENDING,
                    )
                )
            db.commit()

            for target in db.query(Target).filter(Target.scan_id == new_scan.id).all():
                _dispatch(run_ssh_auth_scan, new_scan.id, target.id)
                enqueued += 1
        logger.info("quarterly rescan enqueued %s targets", enqueued)
        return {"enqueued_targets": enqueued}
    finally:
        db.close()


def _dispatch(func, *args):
    """Dispatch a scan task via Celery when a broker is configured.

    In-process (no broker) callers should use FastAPI BackgroundTasks instead;
    this helper is used by beat-scheduled rescans where a broker is present.
    """
    from app.tasks.celery_app import broker_configured

    if broker_configured():
        return func.delay(*args)
    logger.warning("no Celery broker; skipping dispatch of %s", func.__name__)
    return None
