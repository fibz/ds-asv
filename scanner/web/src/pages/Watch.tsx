import { EmptyState } from "../components/EmptyState";

/** Watch surface — the operator home. Real strip/histogram/feed arrive in
 * Phase 4; placeholder so the Phase 1 shell renders. */
export function WatchPage() {
  return (
    <section aria-label="Watch">
      <h1 className="font-display text-2xl font-semibold text-primary">Watch</h1>
      <div className="mt-6">
        <EmptyState message="Live scan strip, severity histogram, and activity feed land in Phase 4." />
      </div>
    </section>
  );
}
