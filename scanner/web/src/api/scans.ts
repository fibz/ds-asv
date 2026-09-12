import { apiRequest } from "./client";
import type {
  Finding,
  ScanAcceptedPayload,
  ScanDetailPayload,
  ScanHistoryItem,
  ScanRequestPayload,
  ScanStatusPayload,
  Severity,
} from "./types";

/** `GET /v1/scans` — all customers (operator) or own customer (QSA, spec §6.2). */
export function listScans(options?: { limit?: number; signal?: AbortSignal }) {
  return apiRequest<ScanHistoryItem[]>("/v1/scans", {
    query: { limit: options?.limit ?? 200 },
    signal: options?.signal,
  });
}

/** `GET /v1/scans/{scan_id}` — status row (polling target). */
export function getScan(id: string, options?: { signal?: AbortSignal }) {
  return apiRequest<ScanStatusPayload>(`/v1/scans/${encodeURIComponent(id)}`, {
    signal: options?.signal,
  });
}

/** `GET /v1/scans/{scan_id}/details` — targets + curated evidence. */
export function getScanDetails(id: string, options?: { signal?: AbortSignal }) {
  return apiRequest<ScanDetailPayload>(
    `/v1/scans/${encodeURIComponent(id)}/details`,
    { signal: options?.signal }
  );
}

export interface FindingsQuery {
  severity?: Severity | "";
  source?: string;
}

/** `GET /v1/scans/{scan_id}/findings` — optional severity/source filters. */
export function getFindings(
  scanId: string,
  query: FindingsQuery = {},
  options?: { signal?: AbortSignal }
) {
  return apiRequest<Finding[]>(`/v1/scans/${encodeURIComponent(scanId)}/findings`, {
    query: { severity: query.severity || undefined, source: query.source || undefined },
    signal: options?.signal,
  });
}

/** `POST /v1/scans` — enqueue a scan (operator; targets must be in scope). */
export function enqueueScan(
  body: ScanRequestPayload,
  options?: { signal?: AbortSignal }
) {
  return apiRequest<ScanAcceptedPayload>("/v1/scans", {
    method: "POST",
    body,
    signal: options?.signal,
  });
}
