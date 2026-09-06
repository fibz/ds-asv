import { EmptyState } from "../components/EmptyState";

/** Scans list page. Real filters/table arrive in Phase 5. */
export function ScansPage() {
  return (
    <section aria-label="Scans">
      <h1 className="font-display text-2xl font-semibold text-primary">Scans</h1>
      <div className="mt-6">
        <EmptyState message="Sortable, filterable scan table lands in Phase 5." />
      </div>
    </section>
  );
}
