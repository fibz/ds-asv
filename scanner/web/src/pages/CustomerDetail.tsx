import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { downloadSar } from "../api/sar";
import { getCustomer, getScopeAudit, listCustomerScans } from "../api/customers";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { SEVERITY_COLORS, SEVERITY_GLYPH, SEVERITY_ORDER } from "../lib/severity";
import { parseScope } from "../lib/scope";
import { formatElapsed, formatTimestamp } from "../lib/time";
import { shortId } from "../lib/truncate";
import type { ScanHistoryItem } from "../api/types";

function copyScope(scope: string[], copied: () => void) {
  navigator.clipboard?.writeText(scope.join("\n")).then(copied, () => undefined);
}

function CidrBadges({ scope }: { scope: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {scope.length === 0 && (
          <span className="font-mono text-xs text-muted">no approved scope</span>
        )}
        {scope.map((cidr) => (
          <span
            key={cidr}
            className="rounded border border-edge bg-surface px-2 py-0.5 font-mono text-[11px] text-primary"
          >
            {cidr}
          </span>
        ))}
      </div>
      {scope.length > 0 && (
        <button
          type="button"
          onClick={() => copyScope(scope, () => setCopied(true))}
          className="mt-2 rounded border border-edge px-2.5 py-1 text-xs text-muted transition hover:border-accent/60 hover:text-primary"
        >
          {copied ? "Copied" : "Copy CIDRs"}
        </button>
      )}
    </div>
  );
}

function MiniScanTable({ scans }: { scans: ScanHistoryItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="dense-table w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-edge text-[11px] uppercase text-muted">
            <th className="px-2 py-1.5 font-medium">Scan</th>
            <th className="px-2 py-1.5 font-medium">Status</th>
            <th className="px-2 py-1.5 font-medium">Result</th>
            <th className="px-2 py-1.5 font-medium">Severity</th>
            <th className="px-2 py-1.5 font-medium">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {scans.map((scan) => (
            <tr key={scan.scan_id} className="border-b border-edge/40">
              <td className="px-2 py-1.5">
                <Link
                  to={`/scans/${encodeURIComponent(scan.scan_id)}`}
                  className="font-mono text-xs text-accent hover:underline"
                  title={scan.scan_id}
                >
                  {shortId(scan.scan_id)}
                </Link>
              </td>
              <td className="px-2 py-1.5 font-mono text-xs text-muted">{scan.status}</td>
              <td
                className={`px-2 py-1.5 font-mono text-xs ${
                  scan.overall_result === "PASS"
                    ? "text-pass"
                    : scan.overall_result === "FAIL"
                      ? "text-accent"
                      : "text-muted"
                }`}
              >
                {scan.overall_result ?? "—"}
              </td>
              <td className="px-2 py-1.5">
                <span className="whitespace-nowrap font-mono text-[11px]">
                  {SEVERITY_ORDER.filter(
                    (s) => (scan.severity_counts?.[s] ?? 0) > 0
                  ).map((s) => (
                    <span key={s} className="mr-2" style={{ color: SEVERITY_COLORS[s] }}>
                      {SEVERITY_GLYPH[s]}
                      <span className="text-muted">{scan.severity_counts?.[s]}</span>
                    </span>
                  ))}
                </span>
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-muted">
                {formatTimestamp(scan.submitted_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Customer detail (operator only, spec §3.3): scope CIDRs, scope-audit
 * timeline, recent scans, SAR downloads. */
export function CustomerDetailPage() {
  const { customerId = "" } = useParams();
  const customerQuery = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => getCustomer(customerId),
    enabled: Boolean(customerId),
  });
  const auditQuery = useQuery({
    queryKey: ["customer", customerId, "scope-audit"],
    queryFn: () => getScopeAudit(customerId),
    enabled: Boolean(customerId),
  });
  const scansQuery = useQuery({
    queryKey: ["customer", customerId, "scans"],
    queryFn: () => listCustomerScans(customerId, { limit: 10 }),
    enabled: Boolean(customerId),
  });

  const error = customerQuery.error ?? auditQuery.error ?? scansQuery.error;
  if (error) {
    return (
      <ErrorState
        title="Could not load customer"
        detail={error.message}
        onDismiss={() => {
          void customerQuery.refetch();
          void auditQuery.refetch();
          void scansQuery.refetch();
        }}
      />
    );
  }
  const customer = customerQuery.data;
  if (!customer) return <EmptyState message="Loading customer…" />;

  const scope = parseScope(customer.scope_ips);
  const completedScans = (scansQuery.data ?? []).filter(
    (s) => s.status === "completed"
  );
  const audit = auditQuery.data ?? [];

  return (
    <section aria-label={`Customer ${customer.name}`} className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Link to="/customers" className="text-accent hover:underline">
          ← Customers
        </Link>
      </div>

      <div className="rounded-lg border border-edge bg-panel px-5 py-4">
        <h1 className="font-display text-2xl font-semibold text-primary">
          {customer.name}
        </h1>
        <dl className="mt-2 grid gap-x-10 gap-y-2 font-mono text-xs sm:grid-cols-3">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted">ID</dt>
            <dd className="mt-0.5 text-primary">{customer.id}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted">Contact</dt>
            <dd className="mt-0.5 text-primary">{customer.contact_email}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted">
              Merchant level
            </dt>
            <dd className="mt-0.5 text-primary">{customer.merchant_level}</dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section
          aria-label="Approved scope"
          className="rounded-lg border border-edge bg-panel p-4"
        >
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
            Approved scope ({scope.length})
          </h2>
          <CidrBadges scope={scope} />
        </section>

        <section
          aria-label="Scope audit"
          className="rounded-lg border border-edge bg-panel p-4"
        >
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
            Scope audit history
          </h2>
          <ul className="max-h-56 space-y-2 overflow-y-auto font-mono text-[11px]">
            {audit.length === 0 && <li className="text-muted">no scope changes</li>}
            {audit.map((event) => (
              <li key={event.id} className="border-l border-edge pl-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-primary">{event.authorization_method}</span>
                  <span className="shrink-0 text-muted">
                    {formatTimestamp(event.created_at)}
                  </span>
                </div>
                <div className="mt-0.5 text-muted">
                  {event.previous_scope} → {event.new_scope}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section
        aria-label="Recent scans"
        className="rounded-lg border border-edge bg-panel p-4"
      >
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
          Recent scans
        </h2>
        <MiniScanTable scans={scansQuery.data ?? []} />
      </section>

      <section
        aria-label="SAR downloads"
        className="rounded-lg border border-edge bg-panel p-4"
      >
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
          SARs ({completedScans.length})
        </h2>
        {completedScans.length === 0 ? (
          <p className="font-mono text-xs text-muted">no completed scans yet</p>
        ) : (
          <ul className="space-y-1">
            {completedScans.map((scan) => (
              <li key={scan.scan_id} className="flex items-center justify-between gap-3 font-mono text-xs">
                <span className="text-primary">{shortId(scan.scan_id)}</span>
                <span className="flex items-center gap-2 text-muted">
                  {formatElapsed(
                    scan.completed_at
                      ? (new Date(scan.completed_at).getTime() -
                          new Date(scan.submitted_at).getTime()) /
                          1000
                      : 0
                  )}
                  <button
                    type="button"
                    onClick={() => void downloadSar(scan.scan_id)}
                    className="rounded border border-edge px-2.5 py-1 text-muted transition hover:border-accent/60 hover:text-primary"
                  >
                    Download
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
