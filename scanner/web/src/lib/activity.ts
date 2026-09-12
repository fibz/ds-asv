import type { ScanHistoryItem } from "../api/types";
import { shortId } from "./truncate";

export interface ActivityEvent {
  at: string; // ISO
  kind: "started" | "completed" | "failed";
  text: string;
}

/**
 * Derive scan state-transition events from the scan history list (spec §3.1).
 * The API has no transition log, so each row yields at most two events:
 * "started" at submitted_at, and "completed PASS/FAIL" / "failed" when the
 * scan reached a terminal state. Sorted newest-first, capped at 20.
 */
export function deriveActivityEvents(scans: ScanHistoryItem[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const scan of scans) {
    const id = shortId(scan.scan_id);
    events.push({ at: scan.submitted_at, kind: "started", text: `Scan ${id} started` });
    if (scan.status === "failed" || scan.status === "partial") {
      events.push({
        at: scan.completed_at ?? scan.submitted_at,
        kind: "failed",
        text: `Scan ${id} ${scan.status}`,
      });
    } else if (scan.status === "completed" && scan.completed_at) {
      events.push({
        at: scan.completed_at,
        kind: "completed",
        text: `Scan ${id} completed ${scan.overall_result ?? "—"}`,
      });
    }
  }
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return events.slice(0, 20);
}
