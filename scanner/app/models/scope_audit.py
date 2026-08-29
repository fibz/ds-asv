"""Append-only record of approved customer scope changes."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.database import Base


class ScopeAuditEvent(Base):
    __tablename__ = "scope_audit_events"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    previous_scope: Mapped[str] = mapped_column(Text, nullable=False)
    new_scope: Mapped[str] = mapped_column(Text, nullable=False)
    authorization_method: Mapped[str] = mapped_column(
        String(50), default="explicit-portal-confirmation", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
