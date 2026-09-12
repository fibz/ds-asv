import { useElapsed } from "../hooks/useElapsed";
import { truncate } from "../lib/truncate";
import type { ScanHistoryItem } from "../api/types";

const TERMINAL = new Set(["completed", "failed", "partial"]);

function stripLabel(scan: ScanHistoryItem): string {
  const target = scan.targets[0];
  return target ? truncate(target, 22) : "—";
}

function ScanBlock({ scan }: { scan: ScanHistoryItem }) {
  const elapsed = useElapsed(scan.submitted_at);
  return (
    <div
      className="w-40 shrink-0 rounded border border-edge bg-panel px-3 py-2"
      title={scan.targets.join(", ")}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none"
        />
        <span className="truncate font-mono text-xs text-primary">
          {stripLabel(scan)}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between font-mono text-[11px] text-muted">
        <span>{scan.status}</span>
        <span>{elapsed}</span>
      </div>
    </div>
  );
}

/**
 * Active-scans strip — the signature element (spec §4.4). One fixed-width
 * block per in-flight scan: pulsing amber dot, truncated target, live elapsed
 * mono timer. Scrolls horizontally; completed scans fall out of the active
 * filter so their blocks disappear (fade/slide handled by CSS transitions in
 * later polish).
 */
export function ScanStrip({ scans }: { scans: ScanHistoryItem[] }) {
  const active = scans.filter((s) => !TERMINAL.has(s.status));
  return (
    <section
      aria-label="In-flight scans"
      className="rounded-lg border border-edge bg-panel p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
          In-flight scans
        </h2>
        <span className="font-mono text-[11px] text-muted">
          {active.length} active
        </span>
      </div>
      {active.length === 0 ? (
        <p className="px-1 py-3 font-mono text-xs text-muted">
          no scans in flight
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {active.map((scan) => (
            <ScanBlock key={scan.scan_id} scan={scan} />
          ))}
        </div>
      )}
    </section>
  );
}
