import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { listCustomers } from "../api/customers";
import { listScans } from "../api/scans";
import { useAuth } from "../auth/store";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { ScanTable } from "../components/ScanTable";
import { SEVERITY_ORDER } from "../lib/severity";
import type { ScanHistoryItem, Severity } from "../api/types";

interface Filters {
  customerId: string; // operator only
  status: string;
  result: string;
  scanType: string;
  severityFloor: Severity | "";
  from: string; // yyyy-mm-dd
  to: string;
}

const EMPTY_FILTERS: Filters = {
  customerId: "",
  status: "",
  result: "",
  scanType: "",
  severityFloor: "",
  from: "",
  to: "",
};

const STATUSES = [
  "pending",
  "enqueued",
  "running",
  "completed",
  "failed",
  "partial",
];
const SCAN_TYPES = ["quarterly", "adhoc", "continuous"];

function severityRank(scan: ScanHistoryItem): number {
  for (let i = 0; i < SEVERITY_ORDER.length; i++) {
    const count = scan.severity_counts?.[SEVERITY_ORDER[i]] ?? 0;
    if (count > 0) return i; // 0 = critical
  }
  return Infinity; // no findings at all
}

function applyFilters(scans: ScanHistoryItem[], f: Filters): ScanHistoryItem[] {
  return scans.filter((scan) => {
    if (f.customerId && scan.customer_id !== f.customerId) return false;
    if (f.status && scan.status !== f.status) return false;
    if (f.result && (scan.overall_result ?? "") !== f.result) return false;
    if (f.scanType && scan.scan_type !== f.scanType) return false;
    if (f.severityFloor) {
      const floorIndex = SEVERITY_ORDER.indexOf(f.severityFloor);
      if (severityRank(scan) > floorIndex) return false;
    }
    const submitted = new Date(scan.submitted_at);
    if (f.from && submitted < new Date(`${f.from}T00:00:00`)) return false;
    if (f.to && submitted > new Date(`${f.to}T23:59:59`)) return false;
    return true;
  });
}

const selectClass =
  "rounded border border-edge bg-surface px-2 py-1.5 text-sm text-primary focus:border-accent";

/**
 * Scans list (spec §3.2). Operator: all customers + customer filter; QSA: only
 * their own customer's scans (server-enforced) — no customer control.
 * Filtering is client-side over the fetched list (/v1/scans has limit only).
 */
export function ScansPage() {
  const role = useAuth((s) => s.role);
  const isOperator = role === "operator";
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const navigate = useNavigate();

  const scansQuery = useQuery({
    queryKey: ["scans", "list"],
    queryFn: () => listScans({ limit: 200 }),
  });
  const customersQuery = useQuery({
    queryKey: ["customers", "select"],
    queryFn: () => listCustomers(),
    enabled: isOperator,
  });

  const filtered = useMemo(
    () => applyFilters(scansQuery.data ?? [], filters),
    [scansQuery.data, filters]
  );

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  if (scansQuery.isError) {
    return (
      <section aria-label="Scans">
        <h1 className="font-display text-2xl font-semibold text-primary">Scans</h1>
        <div className="mt-6">
          <ErrorState
            title="Could not load scans"
            detail={scansQuery.error?.message}
            onDismiss={() => scansQuery.refetch()}
          />
        </div>
      </section>
    );
  }

  const total = scansQuery.data?.length ?? 0;
  const hasFilters = (Object.keys(filters) as (keyof Filters)[]).some(
    (k) => filters[k] !== ""
  );

  return (
    <section aria-label="Scans" className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-primary">Scans</h1>
        {isOperator && (
          <button
            type="button"
            onClick={() => navigate("/portal")}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-surface transition hover:brightness-110"
          >
            Create scan
          </button>
        )}
      </div>

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-edge bg-panel px-4 py-3"
        onSubmit={(e) => e.preventDefault()}
      >
        {isOperator && (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Customer
            <select
              className={selectClass}
              value={filters.customerId}
              onChange={(e) => set("customerId", e.target.value)}
            >
              <option value="">All customers</option>
              {(customersQuery.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted">
          Status
          <select
            className={selectClass}
            value={filters.status}
            onChange={(e) => set("status", e.target.value)}
          >
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Result
          <select
            className={selectClass}
            value={filters.result}
            onChange={(e) => set("result", e.target.value)}
          >
            <option value="">Any result</option>
            <option value="PASS">PASS</option>
            <option value="FAIL">FAIL</option>
            <option value="PENDING">PENDING</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Scan type
          <select
            className={selectClass}
            value={filters.scanType}
            onChange={(e) => set("scanType", e.target.value)}
          >
            <option value="">Any type</option>
            {SCAN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Severity floor
          <select
            className={selectClass}
            value={filters.severityFloor}
            onChange={(e) =>
              set("severityFloor", e.target.value as Severity | "")
            }
          >
            <option value="">Any severity</option>
            {SEVERITY_ORDER.map((s) => (
              <option key={s} value={s}>
                {s}+
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          From
          <input
            type="date"
            className={selectClass}
            value={filters.from}
            onChange={(e) => set("from", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          To
          <input
            type="date"
            className={selectClass}
            value={filters.to}
            onChange={(e) => set("to", e.target.value)}
          />
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="rounded border border-edge px-3 py-1.5 text-sm text-muted transition hover:border-accent/60 hover:text-primary"
          >
            Reset
          </button>
        )}
      </form>

      <p className="font-mono text-[11px] text-muted">
        {filtered.length} of {total} scans shown
      </p>

      {!scansQuery.data ? (
        <EmptyState message="Loading scans…" />
      ) : (
        <ScanTable scans={filtered} />
      )}
    </section>
  );
}
