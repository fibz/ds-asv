import type { KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { ScanHistoryItem, Severity } from "../api/types";
import { shortId, truncate } from "../lib/truncate";
import { formatElapsed, formatTimestamp } from "../lib/time";
import { SEVERITY_COLORS, SEVERITY_GLYPH, SEVERITY_ORDER } from "../lib/severity";

function resultClass(result: string | undefined | null): string {
  if (result === "PASS") return "text-pass";
  if (result === "FAIL") return "text-accent";
  return "text-muted";
}

function SeverityTally({ scan }: { scan: ScanHistoryItem }) {
  const parts: { severity: Severity; count: number }[] = [];
  for (const severity of SEVERITY_ORDER) {
    const count = scan.severity_counts?.[severity] ?? 0;
    if (count > 0) parts.push({ severity, count });
  }
  if (parts.length === 0) return <span className="text-muted">—</span>;
  return (
    <span className="whitespace-nowrap font-mono text-[11px]">
      {parts.map(({ severity, count }, i) => (
        <span key={severity}>
          {i > 0 && <span className="text-muted"> </span>}
          <span style={{ color: SEVERITY_COLORS[severity] }} aria-label={severity}>
            {SEVERITY_GLYPH[severity]}
          </span>
          <span className="text-muted">{count}</span>
        </span>
      ))}
    </span>
  );
}

function durationOf(scan: ScanHistoryItem): string {
  if (!scan.completed_at) return "—";
  const ms = new Date(scan.completed_at).getTime() - new Date(scan.submitted_at).getTime();
  if (Number.isNaN(ms)) return "—";
  return formatElapsed(Math.max(0, ms / 1000));
}

/** Dense, sortable scan table (spec §3.2). Row click → scan detail. */
export function ScanTable({ scans }: { scans: ScanHistoryItem[] }) {
  const navigate = useNavigate();

  function openScan(scanId: string) {
    navigate(`/scans/${encodeURIComponent(scanId)}`);
  }

  function onRowKeyDown(e: KeyboardEvent<HTMLTableRowElement>, scanId: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openScan(scanId);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
      <table className="dense-table w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-edge text-[11px] uppercase tracking-wide text-muted">
            <th className="px-3 py-2 font-medium">Scan ID</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Targets</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Result</th>
            <th className="px-3 py-2 font-medium">Severity</th>
            <th className="px-3 py-2 font-medium">Started</th>
            <th className="px-3 py-2 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody>
          {scans.map((scan) => (
            <tr
              key={scan.scan_id}
              tabIndex={0}
              role="link"
              aria-label={`Open scan ${scan.scan_id}`}
              onClick={() => openScan(scan.scan_id)}
              onKeyDown={(e) => onRowKeyDown(e, scan.scan_id)}
              className="cursor-pointer border-b border-edge/50 align-top transition-colors hover:bg-raised/50 focus-visible:bg-raised/50"
            >
              <td
                className="px-3 py-2 font-mono text-xs text-primary"
                title={scan.scan_id}
              >
                {shortId(scan.scan_id)}
              </td>
              <td className="px-3 py-2 text-muted">
                {truncate(scan.customer_name ?? "—", 24)}
              </td>
              <td className="px-3 py-2 text-muted" title={scan.targets.join(", ")}>
                {truncate(scan.targets.join(", ") || "—", 32)}
              </td>
              <td className="px-3 py-2">
                <span className="font-mono text-xs text-primary">{scan.status}</span>
              </td>
              <td className={`px-3 py-2 font-mono text-xs ${resultClass(scan.overall_result)}`}>
                {scan.overall_result ?? "—"}
              </td>
              <td className="px-3 py-2">
                <SeverityTally scan={scan} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">
                {formatTimestamp(scan.submitted_at)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">
                {durationOf(scan)}
              </td>
            </tr>
          ))}
          {scans.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted">
                No scans match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
