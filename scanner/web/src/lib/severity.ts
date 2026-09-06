import type { ScanHistoryItem, Severity } from "../api/types";
import { formatDayLabel } from "./time";

/** Locked severity colors (spec §4.1/plan Phase 4). */
export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "#E5484D",
  high: "#F5A524",
  medium: "#3DD68C",
  low: "#8A95AD",
  info: "#596579",
};

export const SEVERITY_ORDER: Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export type DayBucket = {
  label: string;
  date: Date;
  counts: Record<Severity, number>;
};

export function totalOf(counts: Record<Severity, number>): number {
  return SEVERITY_ORDER.reduce((acc, s) => acc + counts[s], 0);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Group scans submitted in the last 7 days into per-day severity buckets. */
export function bucketLastSevenDays(
  scans: ScanHistoryItem[],
  now: Date = new Date()
): DayBucket[] {
  const days: DayBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - i);
    days.push({
      label: formatDayLabel(date),
      date,
      counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    });
  }
  for (const scan of scans) {
    const submitted = new Date(scan.submitted_at);
    if (Number.isNaN(submitted.getTime())) continue;
    const bucket = days.find((d) => sameDay(d.date, submitted));
    if (!bucket) continue;
    for (const severity of SEVERITY_ORDER) {
      bucket.counts[severity] += scan.severity_counts?.[severity] ?? 0;
    }
  }
  return days;
}
