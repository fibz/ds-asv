"""Evidence storage reference model."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.database import Base


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    scan_id: Mapped[str] = mapped_column(
        ForeignKey("scans.id", ondelete="CASCADE"), nullable=False
    )
    target_id: Mapped[str | None] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE")
    )
    object_key: Mapped[str] = mapped_column(
        String(500), nullable=False, doc="MinIO/S3 object path"
    )
    bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    evidence_type: Mapped[str] = mapped_column(
        String(50), doc="raw_scan | inventory | sar_pdf | audit_log"
    )
    metadata_json: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
