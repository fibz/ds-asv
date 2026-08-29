"""Scan orchestration model."""

import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, List

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.database import Base

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.finding import Finding
    from app.models.target import Target


class ScanStatus(str, Enum):
    PENDING = "pending"
    ENQUEUED = "enqueued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


class ScanType(str, Enum):
    QUARTERLY = "quarterly"
    ADHOC = "adhoc"
    CONTINUOUS = "continuous"


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), nullable=False
    )
    scan_type: Mapped[str] = mapped_column(String(20), default=ScanType.QUARTERLY)
    status: Mapped[str] = mapped_column(String(20), default=ScanStatus.PENDING)
    auth_method: Mapped[str | None] = mapped_column(
        String(20), doc="ssh-key | winrm | none"
    )
    credentials_reference: Mapped[str | None] = mapped_column(
        String(255), doc="Vault path or AWS SSM parameter name"
    )
    overall_result: Mapped[str | None] = mapped_column(
        String(10), doc="PASS | FAIL | PENDING"
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    customer: Mapped["Customer"] = relationship("Customer", back_populates="scans")
    targets: Mapped[List["Target"]] = relationship("Target", back_populates="scan")
    findings: Mapped[List["Finding"]] = relationship("Finding", back_populates="scan")
