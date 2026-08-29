"""Pydantic request/response schemas."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Customer
# ---------------------------------------------------------------------------


class CustomerCreate(BaseModel):
    name: str
    contact_email: str
    acquirer_name: Optional[str] = None
    merchant_level: int = 4
    scope_ips: Optional[str] = None  # JSON string


class CustomerResponse(BaseModel):
    id: str
    name: str
    contact_email: str
    acquirer_name: Optional[str]
    merchant_level: int
    scope_ips: Optional[str]
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CustomerOnboarding(BaseModel):
    name: str
    contact_email: str
    scope_cidrs: List[str]
    authorization_confirmed: bool = False


# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------


class ScanRequest(BaseModel):
    customer_id: str
    targets: List[str]  # IPs or FQDNs
    auth_method: Optional[str] = "none"  # ssh-key | winrm | none
    scan_type: str = "quarterly"  # quarterly | adhoc | continuous
    credentials_reference: Optional[str] = None


class ScanResponse(BaseModel):
    scan_id: str
    status: str
    enqueued_at: datetime
    estimated_duration_minutes: int

    model_config = {"from_attributes": True}


class ScanStatusResponse(BaseModel):
    scan_id: str
    status: str
    scan_type: str
    auth_method: Optional[str]
    overall_result: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    error_message: Optional[str]

    model_config = {"from_attributes": True}


class ScanHistoryItem(BaseModel):
    scan_id: str
    status: str
    scan_type: str
    overall_result: Optional[str]
    submitted_at: datetime
    completed_at: Optional[datetime]
    targets: List[str]


class PortServiceEvidence(BaseModel):
    port: int
    protocol: str = "tcp"
    service: str = "unknown"
    banner: Optional[str] = None
    tls_version: Optional[str] = None
    cipher_strength: Optional[str] = None


class ScanTargetDetail(BaseModel):
    target: str
    ip_address: Optional[str]
    status: str
    started_at: datetime
    completed_at: Optional[datetime]
    duration_seconds: Optional[int]
    error_message: Optional[str]
    open_ports: List[PortServiceEvidence]


class ScanDetailResponse(BaseModel):
    scan_id: str
    status: str
    overall_result: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    targets: List[ScanTargetDetail]


# ---------------------------------------------------------------------------
# Finding
# ---------------------------------------------------------------------------


class FindingResponse(BaseModel):
    id: str
    target_id: str
    cve_id: Optional[str]
    title: str
    description: Optional[str]
    severity: str
    cvss_score: Optional[float]
    source: str
    pci_fail: bool
    confidence: str
    is_suppressed: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Sar
# ---------------------------------------------------------------------------


class SarDownloadResponse(BaseModel):
    scan_id: str
    download_url: str
    format: str  # pdf | html
