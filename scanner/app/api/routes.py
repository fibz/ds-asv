"""FastAPI route handlers."""

import ipaddress
import json
import logging
from typing import List

from fastapi import (APIRouter, BackgroundTasks, Depends, HTTPException,
                     Response)
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db_session, verify_bearer_token
from app.api.schemas import (CustomerCreate, CustomerOnboarding,
                             CustomerResponse, FindingResponse,
                             PortServiceEvidence, ScanDetailResponse,
                             ScanHistoryItem, ScanRequest, ScanResponse,
                             ScanStatusResponse, ScanTargetDetail)
from app.models.customer import Customer
from app.models.finding import Finding
from app.models.scan import Scan, ScanStatus
from app.models.scope_audit import ScopeAuditEvent
from app.models.target import Target, TargetStatus
from app.reports.sar import generate_sar
from app.scoring.engine import ASVScoringEngine
from app.tasks.celery_app import dispatch_scan
from app.tasks.scanner_tasks import (run_blackbox_scan, run_ssh_auth_scan,
                                     run_winrm_auth_scan)

logger = logging.getLogger("asv.api")
router = APIRouter(prefix="/v1")
scoring_engine = ASVScoringEngine()


# ---------------------------------------------------------------------------
# Customer routes
# ---------------------------------------------------------------------------


def _enqueue_scan_task(background: BackgroundTasks, func, *args) -> None:
    """Dispatch via Celery when a broker is configured; else FastAPI tasks."""
    if dispatch_scan(func, *args) is None:
        background.add_task(func, *args)


def _load_scope(raw):
    """Parse a customer scope_ips JSON list, tolerating malformed/empty input."""
    try:
        entries = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return [str(e) for e in entries]


def _in_scope(target, scope_entries):
    """Return True iff ``target`` falls inside one scope entry.

    Scope entries may be CIDRs (``10.0.0.0/24``), single IPs, or FQDNs. CIDR
    matching is used when both the entry and the target are IP-ish; otherwise a
    case-insensitive exact-string match is used for hostnames.
    """
    for entry in scope_entries:
        entry = entry.strip()
        if not entry:
            continue
        try:
            net = ipaddress.ip_network(entry, strict=False)
        except ValueError:
            if target.lower() == entry.lower():
                return True
            continue
        try:
            addr = ipaddress.ip_address(target)
        except ValueError:
            continue
        if addr in net:
            return True
    return False


def _normalize_narrow_cidrs(entries: List[str]) -> List[str]:
    """Validate and canonicalize a bounded list of narrow IP networks."""
    if not entries:
        raise HTTPException(status_code=422, detail="Approved scope cannot be empty")
    if len(entries) > 32:
        raise HTTPException(
            status_code=422, detail="Approved scope is limited to 32 CIDRs"
        )

    normalized = []
    for raw in entries:
        value = raw.strip()
        if "/" not in value:
            raise HTTPException(
                status_code=422, detail=f"Scope entry must use CIDR notation: {raw}"
            )
        try:
            network = ipaddress.ip_network(value, strict=True)
        except ValueError as exc:
            raise HTTPException(
                status_code=422, detail=f"Invalid CIDR {raw}: {exc}"
            ) from exc

        minimum_prefix = 24 if network.version == 4 else 64
        if network.prefixlen < minimum_prefix:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"CIDR {network} is too broad; IPv{network.version} scope must be "
                    f"/{minimum_prefix} or narrower"
                ),
            )
        if network.is_multicast or network.is_unspecified:
            raise HTTPException(
                status_code=422, detail=f"CIDR {network} is not scannable"
            )

        canonical = str(network)
        if canonical not in normalized:
            normalized.append(canonical)
    return normalized


@router.post("/customers", response_model=CustomerResponse, status_code=201)
def create_customer(
    req: CustomerCreate,
    db: Session = Depends(get_db_session),
    _token: str = Depends(verify_bearer_token),
):
    customer = Customer(
        name=req.name,
        contact_email=req.contact_email,
        acquirer_name=req.acquirer_name,
        merchant_level=req.merchant_level,
        scope_ips=req.scope_ips,
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.get("/customers", response_model=List[CustomerResponse])
def list_customers(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db_session),
    _token: str = Depends(verify_bearer_token),
):
    return db.query(Customer).offset(skip).limit(limit).all()


@router.get("/customers/{customer_id}", response_model=CustomerResponse)
def get_customer(
    customer_id: str,
    db: Session = Depends(get_db_session),
    _token: str = Depends(verify_bearer_token),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@router.get("/customers/{customer_id}/scope/check")
def check_customer_scope(
    customer_id: str,
    target: str,
    db: Session = Depends(get_db_session),
    _token: str = Depends(verify_bearer_token),
):
    """Check one target against persisted scope without creating a scan."""
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    approved_scope = _load_scope(customer.scope_ips)
    allowed = bool(approved_scope) and _in_scope(target.strip(), approved_scope)
    return {
        "target": target.strip(),
        "allowed": allowed,
        "detail": (
            "Target is within the selected customer's approved scope"
            if allowed
            else "Target is outside the selected customer's approved scope"
        ),
    }


@router.get("/customers/{customer_id}/scans", response_model=List[ScanHistoryItem])
def list_customer_scans(
    customer_id: str,
    response: Response,
    limit: int = 50,
    db: Session = Depends(get_db_session),
    _token: str = Depends(verify_bearer_token),
):
    """Return persisted scan history for one selected customer."""
    response.headers["Cache-Control"] = "no-store"
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    limit = max(1, min(limit, 100))
    scans = (
        db.query(Scan)
        .filter(Scan.customer_id == customer_id)
        .order_by(Scan.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        ScanHistoryItem(
            scan_id=scan.id,
            status=scan.status,
            scan_type=scan.scan_type,
            overall_result=scan.overall_result,
            submitted_at=scan.created_at,
            completed_at=scan.completed_at,
            targets=[target.hostname for target in scan.targets],
        )
        for scan in scans
    ]


@router.post("/customers/onboard", response_model=CustomerResponse, status_code=201)
def onboard_customer(
    req: CustomerOnboarding,
    db: Session = Depends(get_db_session),
    _token: str = Depends(verify_bearer_token),
):
    """Create a customer whose confirmed CIDRs become its approved scan scope."""
    if not req.authorization_confirmed:
        raise HTTPException(
            status_code=400,
            detail="Explicit ownership and scan authorization confirmation is required",
        )

    normalized = _normalize_narrow_cidrs(req.scope_cidrs)
    name = req.name.strip()
    contact_email = req.contact_email.strip()
    if not name or "@" not in contact_email:
        raise HTTPException(
            status_code=422, detail="Customer name and valid email are required"
        )
    existing = (
        db.query(Customer)
        .filter(
            func.lower(Customer.name) == name.lower(),
            func.lower(Customer.contact_email) == contact_email.lower(),
            Customer.is_active.is_(True),
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Customer already exists with ID {existing.id}",
        )

    approved_scope = json.dumps(normalized)
    customer = Customer(
        name=name,
        contact_email=contact_email,
        scope_ips=approved_scope,
    )
    db.add(customer)
    db.flush()
    db.add(
        ScopeAuditEvent(
            customer_id=customer.id,
            previous_scope="[]",
            new_scope=approved_scope,
        )
    )
    db.commit()
    db.refresh(customer)
    return customer


# ---------------------------------------------------------------------------
# Scan routes
# ---------------------------------------------------------------------------


@router.post("/scans", response_model=ScanResponse, status_code=202)
def enqueue_scan(
    req: ScanRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db_session),
    _token: str = Depends(verify_bearer_token),
):
    """Enqueue a new ASV scan. Creates scan + target records, then dispatches tasks."""
    customer = db.query(Customer).filter(Customer.id == req.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Validate targets against customer scope
    authorized_scope = _load_scope(customer.scope_ips)
    if not authorized_scope:
        raise HTTPException(
            status_code=403,
            detail="No scope defined; scan refused (empty scope is not allow-all)",
        )
    invalid_targets = [t for t in req.targets if not _in_scope(t, authorized_scope)]
    if invalid_targets:
        raise HTTPException(
            status_code=403,
            detail=f"Targets outside authorized scope: {invalid_targets}",
        )

    scan = Scan(
        customer_id=req.customer_id,
        scan_type=req.scan_type,
        status=ScanStatus.PENDING,
        auth_method=req.auth_method,
        credentials_reference=req.credentials_reference,
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    # Create target records
    target_records = []
    for hostname in req.targets:
        t = Target(
            scan_id=scan.id,
            hostname=hostname,
            auth_method=req.auth_method,
            status=TargetStatus.PENDING,
        )
        db.add(t)
        target_records.append(t)

    db.commit()

    # Dispatch background tasks per-target
    for target in target_records:
        if req.auth_method == "ssh-key":
            _enqueue_scan_task(background, run_ssh_auth_scan, scan.id, target.id)
        elif req.auth_method == "winrm":
            _enqueue_scan_task(background, run_winrm_auth_scan, scan.id, target.id)
        else:
            _enqueue_scan_task(background, run_blackbox_scan, scan.id, target.id)

    # Mark scan as enqueued
    scan.status = ScanStatus.ENQUEUED
    db.commit()

    return ScanResponse(
        scan_id=scan.id,
        status=scan.status,
        enqueued_at=scan.created_at,
        estimated_duration_minutes=len(req.targets) * 45,
    )


@router.get("/scans/{scan_id}", response_model=ScanStatusResponse)
def get_scan_status(
    scan_id: str,
    db: Session = Depends(get_db_session),
    _token: str = Depends(verify_bearer_token),
):
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return ScanStatusResponse(
        scan_id=scan.id,
        status=scan.status,
        scan_type=scan.scan_type,
        auth_method=scan.auth_method,
        overall_result=scan.overall_result,
        started_at=scan.started_at,
        completed_at=scan.completed_at,
        error_message=scan.error_message,
    )


@router.get("/scans/{scan_id}/details", response_model=ScanDetailResponse)
def get_scan_details(
    scan_id: str,
    response: Response,
    db: Session = Depends(get_db_session),
    _token: str = Depends(verify_bearer_token),
):
    """Return curated persisted evidence; never expose raw artifacts or logs."""
    response.headers["Cache-Control"] = "no-store"
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    targets = []
    for target in scan.targets:
        try:
            inventory = json.loads(target.inventory or "{}")
        except (json.JSONDecodeError, TypeError):
            inventory = {}
        banners = inventory.get("banners", []) if isinstance(inventory, dict) else []
        ports = []
        for banner in banners if isinstance(banners, list) else []:
            if not isinstance(banner, dict) or not isinstance(banner.get("port"), int):
                continue
            ports.append(
                PortServiceEvidence(
                    port=banner["port"],
                    protocol=str(banner.get("protocol") or "tcp"),
                    service=str(banner.get("service") or "unknown"),
                    banner=(str(banner["version"]) if banner.get("version") else None),
                    tls_version=(
                        str(banner["tls_version"])
                        if banner.get("tls_version")
                        else None
                    ),
                    cipher_strength=(
                        str(banner["cipher_strength"])
                        if banner.get("cipher_strength")
                        else None
                    ),
                )
            )
        targets.append(
            ScanTargetDetail(
                target=target.hostname,
                ip_address=target.ip_address,
                status=target.status,
                started_at=target.created_at,
                completed_at=target.completed_at,
                duration_seconds=target.scan_duration_seconds,
                error_message=target.error_message,
                open_ports=ports,
            )
        )
    return ScanDetailResponse(
        scan_id=scan.id,
        status=scan.status,
        overall_result=scan.overall_result,
        started_at=scan.started_at,
        completed_at=scan.completed_at,
        targets=targets,
    )


@router.get("/scans/{scan_id}/findings", response_model=List[FindingResponse])
def list_findings(
    scan_id: str,
    severity: str | None = None,
    source: str | None = None,
    db: Session = Depends(get_db_session),
    _token: str = Depends(verify_bearer_token),
):
    query = db.query(Finding).filter(Finding.scan_id == scan_id)
    if severity:
        query = query.filter(Finding.severity == severity)
    if source:
        query = query.filter(Finding.source == source)
    return query.order_by(Finding.cvss_score.desc()).all()


@router.get("/scans/{scan_id}/sar")
def download_sar(
    scan_id: str,
    db: Session = Depends(get_db_session),
    _token: str = Depends(verify_bearer_token),
):
    """Download PCI-compliant Scan Attestation Report (SAR)."""
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    if scan.status != ScanStatus.COMPLETED:
        raise HTTPException(
            status_code=400, detail="SAR available only for completed scans"
        )

    from fastapi.responses import FileResponse

    sar_path = generate_sar(scan_id, db)
    format_type = "pdf" if sar_path.endswith(".pdf") else "html"
    return FileResponse(
        sar_path,
        media_type="application/pdf" if format_type == "pdf" else "text/html",
        filename=f"SAR-{scan_id}.{format_type}",
    )


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@router.get("/health")
def health_check():
    return {"status": "ok", "service": "asv-scanner-api", "version": "1.0.0"}
