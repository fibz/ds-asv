// customer-ui/src/screens/Home.tsx
import { useAssets, useApprovedScopeVersionId, useReports, useScans, useScopeSets } from "../lib/api/queries";
import { quarterInfo, quarterTasks } from "../lib/viewmodels/tasks";
import { finalReportIdsOf } from "../lib/viewmodels/gate";
import { TaskRow } from "../components/shell/TaskRow";
import { Skeleton } from "../components/shell/Skeleton";
import { ErrorState } from "../components/shell/states";
import { Stat } from "../components/primitives/Stat";

/**
 * The quarter checklist. Every number here is read straight from the list
 * endpoints — nothing is invented or approximated. A real zero is shown as 0;
 * while the queries are in flight the checklist and the stats are skeletons,
 * never a zero that the data has not earned yet.
 */
export function Home() {
  const assets = useAssets();
  const scans = useScans();
  const reports = useReports();
  const scopeSets = useScopeSets();
  const approvedScopeVersionId = useApprovedScopeVersionId();

  const loading = assets.isLoading || scans.isLoading || reports.isLoading || scopeSets.isLoading;
  const failure = assets.error ?? scans.error ?? reports.error ?? scopeSets.error;

  if (failure) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8">
        <ErrorState
          message="We couldn’t read your compliance data just now."
          onRetry={() => {
            void assets.refetch();
            void scans.refetch();
            void reports.refetch();
            void scopeSets.refetch();
          }}
        />
      </div>
    );
  }

  const versions = (scopeSets.data ?? []).flatMap((s) => s.versions ?? []);
  const approved =
    versions.filter((v) => v.status === "approved").sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null;
  const hasDraftScope = versions.some((v) => v.status === "draft" || v.status === "submitted");

  // One rule, one place: which reports are final comes from the gate, keyed to
  // the approved scope version the portal itself uses.
  const finalReportIds = finalReportIdsOf(reports.data ?? [], approvedScopeVersionId);

  const now = new Date();
  const quarter = quarterInfo(now);
  const tasks = quarterTasks({
    assets: assets.data ?? [],
    approved,
    hasDraftScope,
    scans: scans.data ?? [],
    reports: reports.data ?? [],
    finalReportIds,
    now,
  });

  const activeAssets = (assets.data ?? []).filter((a) => a.lifecycleState !== "retired");
  const verifiedAssets = activeAssets.filter((a) => a.verificationState === "verified").length;
  const runningScans = (scans.data ?? []).filter((s) => s.status.toUpperCase() === "RUNNING").length;
  const done = tasks.filter((t) => t.state === "complete").length;

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[18px] font-semibold">{quarter.label} checklist</h1>
        <span className="text-[12px] text-[var(--ink-muted)]">
          {done} of {tasks.length} done
        </span>
      </div>

      {loading ? (
        <div className="mt-4">
          <Skeleton lines={6} />
        </div>
      ) : (
        <ol className="mt-4 space-y-2">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ol>
      )}

      <div className="grid grid-cols-3 gap-3 mt-6">
        <Stat
          label="Assets"
          value={loading ? "…" : String(activeAssets.length)}
          caption={loading ? undefined : `${verifiedAssets} verified`}
        />
        <Stat
          label="Scans this quarter"
          value={loading ? "…" : String((scans.data ?? []).length)}
          caption={loading ? undefined : `${runningScans} running`}
        />
        <Stat
          label="Reports final"
          value={loading ? "…" : String(finalReportIds.length)}
          caption={loading ? undefined : `${(reports.data ?? []).length} generated`}
        />
      </div>

      <p className="text-[12px] text-[var(--ink-subtle)] mt-4">
        Findings totals live on the Scans screen — the list endpoints here do not carry them.
      </p>
    </div>
  );
}
