import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { downloadSar } from "../api/sar";
import { getFindings, getScanDetails, listScans } from "../api/scans";
import { useAuth } from "../auth/store";
import { ErrorState } from "../components/ErrorState";
import { FindingTable } from "../components/FindingTable";
import { Inspector } from "../components/Inspector";
import { TargetTable } from "../components/TargetTable";
import { usePollingScan } from "../hooks/usePollingScan";
import { formatTimestamp } from "../lib/time";
import type { Finding } from "../api/types";

function headerValue(label: string, value: ReactNode) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-xs text-primary">{value}</dd>
    </div>
  );
}

/**
 * Scan detail (spec §3.4). Header strip with live status polling (2.5s until
 * terminal), targets panel, findings panel, right inspector. SAR download is
 * gated to completed scans.
 */
export function ScanDetailPage() {
  const { scanId = "" } = useParams();
  const role = useAuth((s) => s.role);
  const qsaCustomerName = useAuth((s) => s.customerName);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [sarBusy, setSarBusy] = useState(false);

  const statusQuery = usePollingScan(scanId);
  const detailsQuery = useQuery({
    queryKey: ["scan", scanId, "details"],
    queryFn: () => getScanDetails(scanId),
    enabled: Boolean(scanId),
  });
  const findingsQuery = useQuery({
    queryKey: ["scan", scanId, "findings"],
    queryFn: () => getFindings(scanId),
    enabled: Boolean(scanId),
  });
  // Customer name is not on the status/detail payloads — resolve from the
  // top-level scan list (cached by the Scans page).
  const scansQuery = useQuery({
    queryKey: ["scans", "list"],
    queryFn: () => listScans({ limit: 200 }),
    enabled: role === "operator",
  });

  const scan = statusQuery.data;
  const error = statusQuery.error ?? detailsQuery.error ?? findingsQuery.error;

  if (!scan && statusQuery.isLoading) {
    return <p className="font-mono text-sm text-muted">loading scan…</p>;
  }
  if (error) {
    return (
      <ErrorState
        title="Could not load scan"
        detail={error.message}
        onDismiss={() => {
          void statusQuery.refetch();
          void detailsQuery.refetch();
          void findingsQuery.refetch();
        }}
      />
    );
  }
  if (!scan) return null;

  const customerName =
    role === "operator"
      ? scansQuery.data?.find((s) => s.scan_id === scanId)?.customer_name ?? null
      : qsaCustomerName;
  const details = detailsQuery.data;
  const findings = findingsQuery.data ?? [];
  const isCompleted = scan.status === "completed";

  async function onDownloadSar() {
    setSarBusy(true);
    await downloadSar(scanId);
    setSarBusy(false);
  }

  return (
    <section aria-label={`Scan ${scanId}`} className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Link to="/scans" className="text-accent hover:underline">
          ← Scans
        </Link>
      </div>

      {/* Header strip (spec §3.4) */}
      <div className="rounded-lg border border-edge bg-panel px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-mono text-lg text-primary">{scanId}</h1>
            <p className="mt-0.5 text-xs text-muted">
              {customerName ?? "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onDownloadSar}
            disabled={!isCompleted || sarBusy}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-surface transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              isCompleted
                ? "Download the SAR (PDF)"
                : "SAR is available only after the scan completes"
            }
          >
            {sarBusy ? "Preparing…" : "Download SAR"}
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {headerValue("Status", scan.status)}
          {headerValue("Result", scan.overall_result ?? "—")}
          {headerValue("Scan type", scan.scan_type)}
          {headerValue("Auth", scan.auth_method ?? "—")}
          {headerValue("Started", formatTimestamp(scan.started_at))}
          {headerValue("Completed", formatTimestamp(scan.completed_at))}
        </dl>
      </div>

      {/* Targets + findings (left), inspector (right when a row is selected) */}
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <section aria-label="Targets" className="rounded-lg border border-edge bg-panel p-4">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
              Targets
            </h2>
            <TargetTable targets={details?.targets ?? []} />
          </section>
          <section aria-label="Findings" className="rounded-lg border border-edge bg-panel p-4">
            <FindingTable
              findings={findings}
              selectedId={selected?.id}
              onSelect={setSelected}
            />
          </section>
        </div>
        {selected ? (
          <Inspector finding={selected} onClose={() => setSelected(null)} />
        ) : (
          <aside className="hidden text-muted xl:block" aria-hidden>
            <p className="rounded-lg border border-dashed border-edge p-6 text-center font-mono text-xs">
              Select a finding to inspect it
            </p>
          </aside>
        )}
      </div>
    </section>
  );
}
