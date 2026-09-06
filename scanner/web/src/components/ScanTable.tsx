import { useState, type KeyboardEvent } from "react";
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
  const ms =
    new Date(scan.completed_at).getTime() - new Date(scan.submitted_at).getTime();
  if (Number.isNaN(ms)) return "—";
  return formatElapsed(Math.max(0, ms / 1000));
}

type SortKey = "submitted_at" | "customer_name" | "status" | "overall_result";

function sortValue(scan: ScanHistoryItem, key: SortKey): string {
  switch (key) {
    case "submitted_at":
      return scan.submitted_at;
    case "customer_name":
      return scan.customer_name ?? "";
    case "status":
      return scan.status;
    case "overall_result":
      return scan.overall_result ?? "";
  }
}

function sortScans(
  scans: ScanHistoryItem[],
  key: SortKey,
  direction: "asc" | "desc"
): ScanHistoryItem[] {
  const copy = [...scans];
  const dir = direction === "asc" ? 1 : -1;
  copy.sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    return av < bv ? -dir : av > bv ? dir : 0;
  });
  return copy;
}

interface Column {
  key: SortKey | null;
  label: string;
  className?: string;
}

const COLUMNS: Column[] = [
  { key: null, label: "Scan ID" },
  { key: "customer_name", label: "Customer" },
  { key: null, label: "Targets" },
  { key: "status", label: "Status" },
  { key: "overall_result", label: "Result" },
  { key: null, label: "Severity" },
  { key: "submitted_at", label: "Started" },
  { key: null, label: "Duration" },
];

/** Dense, sortable scan table (spec §3.2). Row click → scan detail. */
export function ScanTable({ scans }: { scans: ScanHistoryItem[] }) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>("submitted_at");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  }

  const sorted = sortScans(scans, sortKey, direction);

  function openScan(scanId: string) {
    navigate(`/scans/${encodeURIComponent(scanId)}`);
  }

  function onRowKeyDown(e: KeyboardEvent<HTMLTableRowElement>, scanId: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openScan(scanId);
    }
  }

  function headerButton(col: Column) {
    if (!col.key) return <span>{col.label}</span>;
    const active = sortKey === col.key;
    const arrow = active ? (direction === "asc" ? " ↑" : " ↓") : "";
    return (
      <button
        type="button"
        onClick={() => toggleSort(col.key!)}
        aria-sort={
          active ? (direction === "asc" ? "ascending" : "descending") : "none"
        }
        className="font-medium uppercase tracking-wide text-muted transition hover:text-primary"
      >
        {col.label}
        {arrow}
      </button>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
      <table className="dense-table w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-edge text-[11px]">
            {COLUMNS.map((col) => (
              <th key={col.label} className="px-3 py-2">
                {headerButton(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((scan) => (
            <tr
              key={scan.scan_id}
              tabIndex={0}
              role="link"
              aria-label={`Open scan ${scan.scan_id}`}
              onClick={() => openScan(scan.scan_id)}
              onKeyDown={(e) => onRowKeyDown(e, scan.scan_id)}
              className="cursor-pointer border-b border-edge/50 align-top transition-colors hover:bg-raised/50 focus-visible:bg-raised/50"
            >
              <td className="px-3 py-2 font-mono text-xs text-primary" title={scan.scan_id}>
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
          {sorted.length === 0 && (
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
