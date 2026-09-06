import { EmptyState } from "../components/EmptyState";

/** Customers list (operator only). Real table lands in Phase 7. */
export function CustomersPage() {
  return (
    <section aria-label="Customers">
      <h1 className="font-display text-2xl font-semibold text-primary">
        Customers
      </h1>
      <div className="mt-6">
        <EmptyState message="Customer directory lands in Phase 7 (operator only)." />
      </div>
    </section>
  );
}
