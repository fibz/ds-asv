import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "./client";
import type { AssetApi, AuditEventApi, AuthorizationApi, DisputeApi, FindingApi, ReportApi, ScanApi, ScopeSetApi, ScopeVersionApi } from "./types";

export const keys = {
  assets: ["assets"] as const,
  scans: ["scans"] as const,
  reports: ["reports"] as const,
  scopeSets: ["scope-sets"] as const,
  findings: (scanId: string) => ["findings", scanId] as const,
  audit: ["audit"] as const,
  org: ["org"] as const,
};

export const useAssets = (): UseQueryResult<AssetApi[]> =>
  useQuery({ queryKey: keys.assets, queryFn: async () => (await apiGet<{ assets: AssetApi[] }>("/assets")).assets });

export const useScans = (): UseQueryResult<ScanApi[]> =>
  useQuery({ queryKey: keys.scans, queryFn: async () => (await apiGet<{ scans: ScanApi[] }>("/scans")).scans });

export const useReports = (): UseQueryResult<ReportApi[]> =>
  useQuery({ queryKey: keys.reports, queryFn: async () => (await apiGet<{ reports: ReportApi[] }>("/reports")).reports });

/**
 * Generate (or refresh) the report for a completed scan.
 *
 * Contract — read from the portal route, NOT assumed
 * (portal/src/app/api/v1/reports/route.ts):
 *   POST /api/v1/reports
 *   - request body reads exactly one field: { scanId: string }
 *     (required; the route 400s on a missing or blank value)
 *   - 200 { report } on success — idempotent, one report per scan (unique on
 *     scanId): re-posting refreshes the summary and never re-points a report
 *     whose scope version is already linked
 *   - 401 Unauthorized (no session)
 *   - 403 Forbidden — needs the `scan.run` permission
 *     (organization_owner | security_admin | scan_operator). `report.view` is
 *     deliberately not enough: reading a report is not generating one.
 *   - 404 { error: "Scan not found" } when the scan is not in this org
 *   - 409 ReportGuardError — "report requires a COMPLETED scan"
 *   - 500 for anything unexpected
 *
 * On success the report list is refetched — that is what makes the new report
 * appear on screen.
 */
export function useGenerateReport(): UseMutationResult<{ report: ReportApi }, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scanId: string) => apiPost<{ report: ReportApi }>("/reports", { scanId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.reports });
    },
  });
}

export const useScopeSets = (): UseQueryResult<ScopeSetApi[]> =>
  useQuery({ queryKey: keys.scopeSets, queryFn: async () => (await apiGet<{ scopeSets: ScopeSetApi[] }>("/scope-sets")).scopeSets });

export const useScanFindings = (scanId: string | null): UseQueryResult<FindingApi[]> =>
  useQuery({
    queryKey: keys.findings(scanId ?? "none"),
    enabled: Boolean(scanId),
    queryFn: async () => (await apiGet<{ findings: FindingApi[] }>(`/scans/${scanId}/findings`)).findings,
  });

export const useAudit = (): UseQueryResult<AuditEventApi[]> =>
  useQuery({ queryKey: keys.audit, queryFn: async () => (await apiGet<{ events: AuditEventApi[] }>("/audit")).events });

/**
 * Submit a draft scope version for approval.
 *
 * Contract — read from the portal route, NOT assumed
 * (portal/src/app/api/v1/scope-versions/[versionId]/submit/route.ts):
 *   POST /api/v1/scope-versions/{versionId}/submit
 *   - no request body (the version id is the whole input; the route reads none)
 *   - 200 { version } on success
 *   - 401 Unauthorized (no session)
 *   - 403 Forbidden — needs the `scope.manage` permission
 *   - 404 { error: "Scope version not found" } when the version is not in this org
 *   - 409 — ScopeGuardError: "only draft scope versions can be submitted"
 *   - 500 for anything unexpected (routeErrorResponse, raw text never echoed)
 *
 * On success the scope list is refetched: /scope-sets is the only place scope
 * versions are read from (there is no /scope-versions list GET), so
 * invalidating that key is exactly what flips the draft to `submitted` on screen.
 */
export function useSubmitScopeVersion(): UseMutationResult<{ version: ScopeVersionApi }, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => apiPost<{ version: ScopeVersionApi }>(`/scope-versions/${versionId}/submit`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.scopeSets });
    },
  });
}

/**
 * Raise a dispute against a finding.
 *
 * Contract — read from the portal route, NOT assumed
 * (portal/src/app/api/v1/findings/[findingId]/disputes/route.ts):
 *   POST /api/v1/findings/{findingId}/disputes
 *   - request body reads exactly one field: { justification: string }
 *     (required; the route 400s on a missing/blank/whitespace-only value and on
 *     anything longer than 2000 chars — it does NOT trim, the service does)
 *   - 201 { dispute } on success
 *   - 401 Unauthorized (no session)
 *   - 403 Forbidden — needs the `finding.dispute` permission
 *     (organization_owner | security_admin | asset_manager | scan_operator | report_viewer)
 *   - 400 for a malformed/oversized justification
 *   - 404 { error: "Finding not found" } when the finding is not in this org
 *   - 409 DisputeGuardError (service-level justification guard)
 *   - 500 for anything unexpected (routeErrorResponse, raw text never echoed)
 *
 * The route itself does not police the finding's status, so status is the UI's
 * rule: a dispute is only offered while the finding is `open`.
 *
 * On success the findings for the scan are refetched — that is the only read
 * that carries findings, so invalidating it is what makes the new dispute
 * visible on the report.
 */
export function useRaiseDispute(
  scanId: string | null
): UseMutationResult<{ dispute: DisputeApi }, ApiError, { findingId: string; justification: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, justification }) => apiPost<{ dispute: DisputeApi }>(`/findings/${findingId}/disputes`, { justification }),
    onSuccess: () => {
      if (scanId) void queryClient.invalidateQueries({ queryKey: keys.findings(scanId) });
    },
  });
}

/**
 * Issue the signed scope authorisation for an approved scope version.
 *
 * Contract — read from the portal route, NOT assumed
 * (portal/src/app/api/v1/scope-versions/[versionId]/authorization/route.ts):
 *   POST /api/v1/scope-versions/{versionId}/authorization
 *   - no request body (the version id is the whole input; the route reads none)
 *   - 201 { authorization } on success — statementHash, scopeVersionHash and an
 *     HMAC signature, plus the version it was issued against
 *   - 401 Unauthorized (no session)
 *   - 403 Forbidden — needs the `authorization.issue` permission
 *     (organization_owner | security_admin)
 *   - 409 ScopeGuardError ("Scope version not found" / "authorization requires
 *     an approved scope version")
 *   - 500 for anything unexpected (routeErrorResponse, raw text never echoed)
 *
 * There is no GET for an authorisation — the only way to see one is to issue
 * it — so this is a mutation, and the screen keeps the returned statement.
 * The route upserts the (unique) authorisation row for the version, so the
 * scope-set read is marked stale on success; note that /scope-sets does not
 * carry authorisation fields today, so the screen's "already issued" evidence
 * comes from this mutation's result rather than from a refetch.
 */
export function useIssueAuthorization(): UseMutationResult<{ authorization: AuthorizationApi }, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => apiPost<{ authorization: AuthorizationApi }>(`/scope-versions/${versionId}/authorization`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.scopeSets });
    },
  });
}

/** Shape of GET /api/v1/org (portal/src/lib/org/profile.ts → OrgProfile). */
export interface OrgApi {
  id: string;
  name: string;
  parentOrgId: string | null;
  parentName: string | null;
  contacts: { id: string; type: string; name: string; email: string; phone: string | null; escalationOrder: number }[];
}

export const useOrg = (): UseQueryResult<OrgApi> =>
  useQuery({ queryKey: keys.org, queryFn: () => apiGet<OrgApi>("/org") });

export { ApiError };
