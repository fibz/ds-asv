import type { Finding, Severity } from "../api/types";

/** Client-side severity-floor filter for finding lists (unit-test target). */
export function filterBySeverity(
  findings: Finding[],
  floor: Severity | ""
): Finding[] {
  if (!floor) return findings;
  const RANK: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  return findings.filter((f) => RANK[f.severity] <= RANK[floor]);
}
