/** Shared response payload types, mirroring `scanner/app/api/schemas.py`. */

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type ScanStatus =
  | "pending"
  | "enqueued"
  | "running"
  | "completed"
  | "failed"
  | "partial";
export type FindingSource =
  | "authenticated_dpkg"
  | "authenticated_rpm"
  | "unauthenticated_banner";

export interface Customer {
  id: string;
  name: string;
  contact_email: string;
  acquirer_name?: string | null;
  merchant_level: number;
  scope_ips?: string | null; // JSON array string of CIDRs/FQDNs
  is_active: boolean;
  created_at: string;
}

export interface ScopeAuditEvent {
  id: string;
  customer_id: string;
  previous_scope: string; // JSON string
  new_scope: string; // JSON string
  authorization_method: string;
  created_at: string;
}

export interface ScanStatusPayload {
  scan_id: string;
  status: ScanStatus;
  scan_type: string;
  auth_method?: string | null;
  overall_result?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
}

export interface ScanHistoryItem {
  scan_id: string;
  status: ScanStatus;
  scan_type: string;
  overall_result?: string | null;
  submitted_at: string;
  completed_at?: string | null;
  targets: string[];
  customer_id?: string | null;
  customer_name?: string | null;
  severity_counts?: Partial<Record<Severity, number>> | null;
}

export interface PortServiceEvidence {
  port: number;
  protocol: string;
  service: string;
  banner?: string | null;
  tls_version?: string | null;
  cipher_strength?: string | null;
}

export interface ScanTargetDetail {
  target: string;
  ip_address?: string | null;
  status: string;
  started_at: string;
  completed_at?: string | null;
  duration_seconds?: number | null;
  error_message?: string | null;
  open_ports: PortServiceEvidence[];
}

export interface ScanDetailPayload {
  scan_id: string;
  status: ScanStatus;
  overall_result?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  targets: ScanTargetDetail[];
}

export interface Finding {
  id: string;
  target_id: string;
  cve_id?: string | null;
  title: string;
  description?: string | null;
  severity: Severity;
  cvss_score?: number | null;
  cvss_vector?: string | null;
  source: FindingSource | string;
  pci_fail: boolean;
  confidence: string;
  is_suppressed: boolean;
  suppression_reason?: string | null;
  raw_evidence?: string | null; // JSON blob string
  created_at: string;
}

export interface FindingSuppressResult {
  id: string;
  is_suppressed: boolean;
  suppression_reason?: string | null;
}

export interface ScanRequestPayload {
  customer_id: string;
  targets: string[];
  auth_method?: string;
  scan_type?: string;
  credentials_reference?: string | null;
}

export interface ScanAcceptedPayload {
  scan_id: string;
  status: string;
  enqueued_at: string;
  estimated_duration_minutes: number;
}
