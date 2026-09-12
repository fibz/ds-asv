import { useQuery } from "@tanstack/react-query";
import { listScans } from "../api/scans";
import { ActivityFeed } from "../components/ActivityFeed";
import { ScanStrip } from "../components/ScanStrip";
import { SeverityHistogram } from "../components/SeverityHistogram";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";

/**
 * Watch surface — the operator home (spec §3.1). Polls the top-level scan
 * list every 2.5s while any scan is in flight so the strip stays live; the
 * histogram and activity feed derive from the same fetch.
 */
export function WatchPage() {
  const scansQuery = useQuery({
    queryKey: ["scans", "watch"],
    queryFn: () => listScans({ limit: 200 }),
    refetchInterval: (query) => {
      const hasActive = (query.state.data ?? []).some(
        (s) => !["completed", "failed", "partial"].includes(s.status)
      );
      return hasActive ? 2500 : 15_000;
    },
  });

  if (scansQuery.isError) {
    return (
      <section aria-label="Watch">
        <h1 className="font-display text-2xl font-semibold text-primary">Watch</h1>
        <div className="mt-6">
          <ErrorState
            title="Could not load scan activity"
            detail={scansQuery.error?.message}
            onDismiss={() => scansQuery.refetch()}
          />
        </div>
      </section>
    );
  }

  if (!scansQuery.data) {
    return (
      <section aria-label="Watch">
        <h1 className="font-display text-2xl font-semibold text-primary">Watch</h1>
        <div className="mt-6">
          <EmptyState message="Loading scan activity…" />
        </div>
      </section>
    );
  }

  const scans = scansQuery.data;
  return (
    <section aria-label="Watch" className="space-y-6">
      <h1 className="font-display text-2xl font-semibold text-primary">Watch</h1>
      <ScanStrip scans={scans} />
      <div className="grid gap-6 lg:grid-cols-2">
        <SeverityHistogram scans={scans} />
        <ActivityFeed />
      </div>
    </section>
  );
}
