"""Vulnerability finding model."""

import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.database import Base

if TYPE_CHECKING:
    from app.models.scan import Scan
    from app.models.target import Target


class FindingSeverity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class FindingConfidence(str, Enum):
    AUTHENTICATED = "authenticated"  # Ground truth
    UNCERTAIN = "uncertain"  # Banner-based
    SUPPRESSED = "suppressed"  # Customer-disputed


class Finding(Base):
    __tablename__ = "findings"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    scan_id: Mapped[str] = mapped_column(
        ForeignKey("scans.id", ondelete="CASCADE"), nullable=False
    )
    target_id: Mapped[str] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), nullable=False
    )
    cve_id: Mapped[str | None] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(20), default=FindingSeverity.MEDIUM)
    cvss_score: Mapped[float | None] = mapped_column(Numeric(3, 1))
    cvss_vector: Mapped[str | None] = mapped_column(String(100))
    confidence: Mapped[str] = mapped_column(
        String(20), default=FindingConfidence.UNCERTAIN
    )
    source: Mapped[str] = mapped_column(
        String(50),
        doc="authenticated_dpkg | authenticated_rpm | unauthenticated_banner",
    )
    raw_evidence: Mapped[str | None] = mapped_column(
        Text, doc="JSON blob of supporting evidence"
    )
    pci_fail: Mapped[bool] = mapped_column(
        Boolean, default=False, doc="True if this finding causes PCI scan failure"
    )
    is_suppressed: Mapped[bool] = mapped_column(
        Boolean, default=False, doc="Customer disputes this finding"
    )
    suppression_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    scan: Mapped["Scan"] = relationship("Scan", back_populates="findings")
    target: Mapped["Target"] = relationship("Target", back_populates="findings")
