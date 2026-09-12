import { useAssets, useApprovedScopeVersionId, useReports, useScans, useScopeSets } from "../api/queries";
import { finalReportIdsOf } from "../viewmodels/gate";
import { quarterInfo, type QuarterInfo } from "../viewmodels/tasks";
import { stageRows, type StageRow } from "../viewmodels/stages";

/**
 * The single place the sidebar's stage state is derived. Home consumes it too —
 * two independent derivations of "which stage is complete" would drift.
 */
export function useStageRows(): { rows: StageRow[]; quarter: QuarterInfo; loading: boolean; error: unknown } {
  const assets = useAssets();
  const scans = useScans();
  const reports = useReports();
  const scopeSets = useScopeSets();
  const approvedScopeVersionId = useApprovedScopeVersionId();

  const versions = (scopeSets.data ?? []).flatMap((s) => s.versions ?? []);
  const approved = versions
    .filter((v) => v.status === "approved")
    .sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null;
  const hasDraftScope = versions.some((v) => v.status === "draft" || v.status === "submitted");

  const finalReportIds = finalReportIdsOf(reports.data ?? [], approvedScopeVersionId);

  const rows = stageRows({
    assets: assets.data ?? [], approved, hasDraftScope,
    scans: scans.data ?? [], reports: reports.data ?? [], finalReportIds,
  });

  return {
    rows,
    quarter: quarterInfo(new Date()),
    loading: assets.isLoading || scans.isLoading || reports.isLoading || scopeSets.isLoading,
    error: assets.error ?? scans.error ?? reports.error ?? scopeSets.error,
  };
}
