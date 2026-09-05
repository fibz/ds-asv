"""Real-postgres integration tests for the scanner's SQLAlchemy layer.

Exercise the model layer against the fixture postgres (see conftest.py): the
full Customer -> Scan -> Target -> Finding -> Evidence -> ScopeAuditEvent
relationship graph, DB-enforced cascades, and the append-only scope audit
surviving an actual commit + fresh-session read-back.

Skipped wholesale when the integration postgres is unreachable (docker
absent) — see the session fixture in conftest.py.
"""

from sqlalchemy import inspect, select, text

from app.models.customer import Customer
from app.models.database import SessionLocal
from app.models.evidence import Evidence
from app.models.finding import Finding, FindingConfidence, FindingSeverity
from app.models.scan import Scan, ScanStatus, ScanType
from app.models.scope_audit import ScopeAuditEvent
from app.models.target import Target, TargetStatus


def _seed_customer_chain(session):
    """Create one customer with a scan, a target, a finding, evidence, and a
    scope-audit event; return the roots for assertions."""
    customer = Customer(
        name="Acme IT",
        contact_email="it@acme.test",
        acquirer_name="Test Acquiring",
        merchant_level=4,
        scope_ips='["10.0.0.0/24"]',
        is_active=True,
    )
    session.add(customer)
    session.flush()

    scan = Scan(
        customer_id=customer.id,
        scan_type=ScanType.QUARTERLY,
        status=ScanStatus.RUNNING,
        auth_method="ssh-key",
    )
    session.add(scan)
    session.flush()

    target = Target(
        scan_id=scan.id,
        hostname="web.acme.test",
        ip_address="10.0.0.5",
        port=443,
        status=TargetStatus.RUNNING,
    )
    session.add(target)
    session.flush()

    finding = Finding(
        scan_id=scan.id,
        target_id=target.id,
        cve_id="CVE-2026-0001",
        title="TLS 1.0 enabled",
        description="Server permits legacy TLS 1.0 handshakes",
        severity=FindingSeverity.HIGH,
        cvss_score=7.5,
        cvss_vector="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
        confidence=FindingConfidence.UNCERTAIN,
        source="unauthenticated_banner",
        raw_evidence='{"banner": "TLS1.0"}',
        pci_fail=True,
    )
    session.add(finding)
    session.flush()

    evidence = Evidence(
        scan_id=scan.id,
        target_id=target.id,
        object_key="scans/scan_1/evidence.json",
        bucket="asv-evidence",
        content_sha256="a" * 64,
        evidence_type="raw_scan",
        metadata_json='{"probe": "testssl"}',
    )
    session.add(evidence)

    audit = ScopeAuditEvent(
        customer_id=customer.id,
        previous_scope="[]",
        new_scope='["10.0.0.0/24"]',
        authorization_method="explicit-portal-confirmation",
    )
    session.add(audit)
    session.commit()
    session.refresh(customer)
    return customer


def test_init_db_creates_expected_tables():
    """init_db (from conftest) materializes every model as a real table."""
    inspector = inspect(SessionLocal().get_bind())
    tables = set(inspector.get_table_names())
    assert {
        "customers",
        "scans",
        "targets",
        "findings",
        "evidence",
        "scope_audit_events",
    } <= tables


def test_full_relationship_graph_survives_commit_and_reload():
    """A committed chain reads back intact through a fresh session, with
    all relationships traversable."""
    session = SessionLocal()
    customer = _seed_customer_chain(session)
    customer_id = customer.id
    session.close()

    fresh = SessionLocal()
    try:
        loaded = fresh.get(Customer, customer_id)
        assert loaded is not None
        assert len(loaded.scans) == 1
        scan = loaded.scans[0]
        assert scan.scan_type == ScanType.QUARTERLY
        assert len(scan.targets) == 1
        target = scan.targets[0]
        assert target.hostname == "web.acme.test"
        assert len(target.findings) == 1
        finding = target.findings[0]
        assert finding.severity == FindingSeverity.HIGH
        assert finding.pci_fail is True
        assert len(scan.findings) == 1
        evidence = fresh.scalars(
            select(Evidence).where(Evidence.scan_id == scan.id)
        ).first()
        assert evidence is not None
        assert evidence.bucket == "asv-evidence"
        assert evidence.content_sha256 == "a" * 64
    finally:
        fresh.close()


def test_scope_audit_is_recorded_per_customer():
    """Scope-audit events persist and stay linked to their customer."""
    session = SessionLocal()
    customer = _seed_customer_chain(session)
    customer_id = customer.id
    session.close()

    fresh = SessionLocal()
    try:
        rows = fresh.scalars(
            select(ScopeAuditEvent).where(ScopeAuditEvent.customer_id == customer_id)
        ).all()
        assert len(rows) == 1
        assert rows[0].new_scope == '["10.0.0.0/24"]'
        assert rows[0].authorization_method == "explicit-portal-confirmation"
    finally:
        fresh.close()


def test_deleting_customer_cascades_to_scan_target_finding_evidence():
    """DB-enforced ON DELETE CASCADE: removing the customer removes the whole
    tree (scan, target, finding, evidence, scope audit), never leaving orphans."""
    session = SessionLocal()
    customer = _seed_customer_chain(session)
    customer_id = customer.id
    scan = customer.scans[0]
    scan_id = scan.id
    target_id = scan.targets[0].id
    finding_id = scan.findings[0].id
    evidence = session.scalars(
        select(Evidence).where(Evidence.scan_id == scan_id)
    ).first()
    evidence_id = evidence.id
    audit = session.scalars(
        select(ScopeAuditEvent).where(ScopeAuditEvent.customer_id == customer_id)
    ).first()
    audit_id = audit.id
    # Raw SQL delete on purpose: the DB cascade (ondelete CASCADE) is the
    # behavior under test. `session.delete(customer)` would instead make the
    # ORM null out every child FK first, which hits the NOT NULL constraints.
    session.execute(text("DELETE FROM customers WHERE id = :cid"), {"cid": customer_id})
    session.commit()

    try:
        # Every row in the deleted customer's tree is gone — cascade reached
        # each depth (scan -> target -> finding/evidence, scope audit).
        assert session.get(Customer, customer_id) is None
        assert session.get(Scan, scan_id) is None
        assert session.get(Target, target_id) is None
        assert session.get(Finding, finding_id) is None
        assert session.get(Evidence, evidence_id) is None
        assert session.get(ScopeAuditEvent, audit_id) is None
    finally:
        session.close()


def test_session_roundtrip_updates_persist():
    """A status transition from a second session is visible to a third."""
    session = SessionLocal()
    customer = _seed_customer_chain(session)
    scan_id = customer.scans[0].id
    session.close()

    updater = SessionLocal()
    try:
        scan = updater.get(Scan, scan_id)
        scan.status = ScanStatus.COMPLETED
        scan.overall_result = "PASS"
        updater.commit()
    finally:
        updater.close()

    reader = SessionLocal()
    try:
        scan = reader.get(Scan, scan_id)
        assert scan.status == ScanStatus.COMPLETED
        assert scan.overall_result == "PASS"
    finally:
        reader.close()
