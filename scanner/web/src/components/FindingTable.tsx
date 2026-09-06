import { useMemo, useState } from "react";
import type { Finding, Severity } from "../api/types";
import { filterBySeverity } from "../lib/findings";
import { PciBar } from "./PciBar";
import { SeverityGlyph } from "./SeverityGlyph";
import { truncate } from "../lib/truncate";

/**
 * Dense findings table (spec §3.4). Each row: severity glyph, title, CVSS,
 * source — with the 3px PCI pass/fail bar on the row edge. Row click opens the
 * right inspector via `onSelect`.
 */
export function FindingTable({
  findings,
  selectedId,
  onSelect,
  severityFloor = "",
}: {
  findings: Finding[];
  selectedId?: string | null;
  onSelect: (finding: Finding) => void;
  severityFloor?: Severity | "";
}) {
  const [floor, setFloor] = useState<Severity | "">(severityFloor);
  const rows = useMemo(() => filterBySeverity(findings, floor), [findings, floor]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
          Findings
        </h2>
        <label className="flex items-center gap-2 text-xs text-muted">
          Severity floor
          <select
            value={floor}
            onChange={(e) => setFloor(e.target.value as Severity | "")}
            className="rounded border border-edge bg-surface px-2 py-1 text-xs text-primary"
          >
            <option value="">All</option>
            <option value="critical">critical</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
        <table className="dense-table w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-edge text-[11px] uppercase text-muted">
              <th className="px-3 py-2 font-medium">Severity</th>
              <th className="px-3 py-2 font-medium">Finding</th>
              <th className="px-3 py-2 font-medium">CVSS</th>
              <th className="px-3 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr
                key={f.id}
                onClick={() => onSelect(f)}
                tabIndex={0}
                role="button"
                aria-label={`Inspect finding: ${f.title}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(f);
                  }
                }}
                className={`relative cursor-pointer border-b border-edge/50 transition-colors hover:bg-raised/50 focus-visible:bg-raised/50 ${
                  selectedId === f.id ? "bg-raised/60" : ""
                }`}
              >
                <PciBar fail={f.pci_fail} />
                <td className="px-3 py-2 align-top">
                  <SeverityGlyph severity={f.severity} label />
                </td>
                <td className="px-3 py-2 align-top text-primary">
                  <span
                    className="block max-w-md truncate"
                    title={f.title}
                  >
                    {truncate(f.title, 90)}
                  </span>
                  {f.cve_id && (
                    <span className="mt-0.5 block font-mono text-[11px] text-muted">
                      {f.cve_id}
                      {f.is_suppressed && (
                        <span className="ml-2 text-critical">suppressed</span>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 align-top font-mono text-xs text-primary">
                  {f.cvss_score ?? "—"}
                </td>
                <td className="px-3 py-2 align-top font-mono text-[11px] text-muted">
                  {f.source}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted">
                  No findings match this severity floor.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
