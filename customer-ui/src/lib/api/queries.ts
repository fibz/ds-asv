import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "./client";
import type { AssetApi, AuditEventApi, FindingApi, ReportApi, ScanApi, ScopeSetApi, ScopeVersionApi } from "./types";

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
