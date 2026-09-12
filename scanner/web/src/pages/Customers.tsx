import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { listCustomers } from "../api/customers";
import { listScans } from "../api/scans";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { parseScope } from "../lib/scope";
import { formatTimestamp } from "../lib/time";
import { truncate } from "../lib/truncate";
import type { Customer } from "../api/types";

interface CustomerRow {
  customer: Customer;
  scopeCount: number;
  lastScanAt: string | null;
  findingCount: number;
}

function findingTotal(scan: { severity_counts?: Record<string, number> | null }) {
  if (!scan.severity_counts) return 0;
  return Object.values(scan.severity_counts).reduce((a, b) => a + b, 0);
}

/** Customers list (operator only, spec §3.3). */
export function CustomersPage() {
  const navigate = useNavigate();
  const customersQuery = useQuery({
    queryKey: ["customers", "list"],
    queryFn: () => listCustomers(),
  });
  const scansQuery = useQuery({
    queryKey: ["scans", "list"],
    queryFn: () => listScans({ limit: 200 }),
  });

  const rows = useMemo<CustomerRow[]>(() => {
    const byCustomer = new Map<string, { last: string | null; findings: number }>();
    for (const scan of scansQuery.data ?? []) {
      const entry = byCustomer.get(scan.customer_id ?? "");
      const at = scan.submitted_at;
      if (!entry) {
        byCustomer.set(scan.customer_id ?? "", { last: at, findings: findingTotal(scan) });
      } else {
        if (at > (entry.last ?? "")) entry.last = at;
        entry.findings += findingTotal(scan);
      }
    }
    return (customersQuery.data ?? []).map((customer) => {
      const agg = byCustomer.get(customer.id);
      return {
        customer,
        scopeCount: parseScope(customer.scope_ips).length,
        lastScanAt: agg?.last ?? null,
        findingCount: agg?.findings ?? 0,
      };
    });
  }, [customersQuery.data, scansQuery.data]);

  if (customersQuery.isError) {
    return (
      <section aria-label="Customers">
        <h1 className="font-display text-2xl font-semibold text-primary">Customers</h1>
        <div className="mt-6">
          <ErrorState
            title="Could not load customers"
            detail={customersQuery.error?.message}
            onDismiss={() => customersQuery.refetch()}
          />
        </div>
      </section>
    );
  }

  if (!customersQuery.data) {
    return (
      <section aria-label="Customers">
        <h1 className="font-display text-2xl font-semibold text-primary">Customers</h1>
        <div className="mt-6">
          <EmptyState message="Loading customers…" />
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Customers" className="space-y-6">
      <h1 className="font-display text-2xl font-semibold text-primary">Customers</h1>
      <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
        <table className="dense-table w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-edge text-[11px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Contact</th>
              <th className="px-3 py-2 font-medium">Merchant level</th>
              <th className="px-3 py-2 font-medium">Scope CIDRs</th>
              <th className="px-3 py-2 font-medium">Last scan</th>
              <th className="px-3 py-2 font-medium">Findings</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ customer, scopeCount, lastScanAt, findingCount }) => (
              <tr
                key={customer.id}
                tabIndex={0}
                role="link"
                aria-label={`Open customer ${customer.name}`}
                onClick={() => navigate(`/customers/${encodeURIComponent(customer.id)}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/customers/${encodeURIComponent(customer.id)}`);
                  }
                }}
                className="cursor-pointer border-b border-edge/50 transition-colors hover:bg-raised/50 focus-visible:bg-raised/50"
              >
                <td className="px-3 py-2 font-medium text-primary">
                  {truncate(customer.name, 40)}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted">
                  {customer.contact_email}
                </td>
                <td className="px-3 py-2 text-muted">{customer.merchant_level}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted">{scopeCount}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">
                  {lastScanAt ? formatTimestamp(lastScanAt) : "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-primary">
                  {findingCount}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted">
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
