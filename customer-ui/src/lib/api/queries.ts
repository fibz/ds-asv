import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiGet, ApiError } from "./client";
import type { AssetApi, AuditEventApi, FindingApi, ReportApi, ScanApi, ScopeSetApi } from "./types";

export const keys = {
  assets: ["assets"] as const,
  scans: ["scans"] as const,
  reports: ["reports"] as const,
  scopeSets: ["scope-sets"] as const,
  findings: (scanId: string) => ["findings", scanId] as const,
  audit: ["audit"] as const,
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
 * The one place the "approved scope version" is read. Home, Reports and
 * ReportDetail consume this so the gate cannot drift between screens.
 * Versions arrive nested inside /scope-sets, so this is a pure derivation over
 * that one response. Returns the newest approved version id, or null.
 */
export function useApprovedScopeVersionId(): string | null {
  const sets = useScopeSets();
  const versions = (sets.data ?? []).flatMap((s) => s.versions ?? []);
  const approved = versions.filter((v) => v.status === "approved").sort((a, b) => b.versionNumber - a.versionNumber);
  return approved[0]?.id ?? null;
}

export { ApiError };
