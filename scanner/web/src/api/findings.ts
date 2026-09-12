import { apiRequest } from "./client";
import { getFindings } from "./scans";
import type { Finding, FindingSuppressResult, Severity } from "./types";

export type { Finding };

/** List a scan's findings (re-exported from scans.ts for call-site clarity). */
export function listFindingsByScan(
  scanId: string,
  options?: { severity?: Severity | ""; source?: string; signal?: AbortSignal }
) {
  return getFindings(
    scanId,
    { severity: options?.severity, source: options?.source },
    { signal: options?.signal }
  );
}

/**
 * `PATCH /v1/findings/{finding_id}/suppress` — QSA suppresses a finding within
 * their customer scope; operator may suppress any finding (spec §2, §3.5).
 */
export function suppressFinding(
  findingId: string,
  reason?: string,
  options?: { signal?: AbortSignal }
) {
  return apiRequest<FindingSuppressResult>(
    `/v1/findings/${encodeURIComponent(findingId)}/suppress`,
    {
      method: "PATCH",
      body: reason ? { reason } : {},
      signal: options?.signal,
    }
  );
}
