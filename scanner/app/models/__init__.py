"""ASV Scanner database models."""

from app.models.customer import Customer
from app.models.database import Base, SessionLocal
from app.models.database import _get_engine as engine
from app.models.database import get_db_session
from app.models.evidence import Evidence
from app.models.finding import Finding, FindingConfidence, FindingSeverity
from app.models.scan import Scan, ScanStatus, ScanType
from app.models.scope_audit import ScopeAuditEvent
from app.models.target import Target, TargetStatus

# Backwards compatibility aliases
get_db = get_db_session

__all__ = [
    "Base",
    "engine",
    "get_db",
    "get_db_session",
    "SessionLocal",
    "Customer",
    "Scan",
    "ScanStatus",
    "ScanType",
    "Target",
    "TargetStatus",
    "Finding",
    "FindingSeverity",
    "FindingConfidence",
    "Evidence",
    "ScopeAuditEvent",
]
