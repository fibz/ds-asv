"""Pydantic request/response schemas."""

from datetime import datetime
from typing import Dict, List, Optional

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
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    severity_counts: Optional[Dict[str, int]] = None


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
    cvss_vector: Optional[str] = None
    source: str
    pci_fail: bool
    confidence: str
    is_suppressed: bool
    suppression_reason: Optional[str] = None
    raw_evidence: Optional[str] = None  # JSON blob string (Inspector viewer)
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Sar
# ---------------------------------------------------------------------------


class SarDownloadResponse(BaseModel):
    scan_id: str
    download_url: str
    format: str  # pdf | html


# ---------------------------------------------------------------------------
# Dashboard (scanner/web) additions — design spec §6
# ---------------------------------------------------------------------------


class MeResponse(BaseModel):
    role: str  # "operator" | "qsa"
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None


class ScopeAuditResponse(BaseModel):
    id: str
    customer_id: str
    previous_scope: str
    new_scope: str
    authorization_method: str
    created_at: datetime

    model_config = {"from_attributes": True}


class FindingSuppressRequest(BaseModel):
    reason: Optional[str] = None


class FindingSuppressResponse(BaseModel):
    id: str
    is_suppressed: bool
    suppression_reason: Optional[str]

    model_config = {"from_attributes": True}
