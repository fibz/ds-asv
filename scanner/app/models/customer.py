"""Customer (merchant) model."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.database import Base

if TYPE_CHECKING:
    from app.models.scan import Scan


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False)
    acquirer_name: Mapped[str | None] = mapped_column(String(255))
    merchant_level: Mapped[int | None] = mapped_column(default=4)  # 1-4 per PCI
    scope_ips: Mapped[str | None] = mapped_column(
        Text, doc="JSON array of IPs, CIDRs, FQDNs"
    )
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    scans: Mapped[List["Scan"]] = relationship("Scan", back_populates="customer")
