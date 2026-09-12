import { describe, expect, it } from "vitest";
import type { ScanHistoryItem } from "../api/types";
import {
  bucketLastSevenDays,
  SEVERITY_COLORS,
  SEVERITY_GLYPH,
  SEVERITY_ORDER,
  totalOf,
} from "./severity";

function scan(over: {
  scan_id: string;
  submitted_at: string;
  status?: string;
  severity_counts?: ScanHistoryItem["severity_counts"];
}): ScanHistoryItem {
  return {
    scan_id: over.scan_id,
    status: (over.status ?? "completed") as ScanHistoryItem["status"],
    scan_type: "quarterly",
    submitted_at: over.submitted_at,
    targets: ["10.0.0.1"],
    severity_counts: over.severity_counts,
  };
}

describe("severity glyph mapping", () => {
  it("maps each severity to its mono glyph", () => {
    expect(SEVERITY_GLYPH.critical).toBe("▲");
    expect(SEVERITY_GLYPH.high).toBe("●");
    expect(SEVERITY_GLYPH.medium).toBe("◆");
    expect(SEVERITY_GLYPH.low).toBe("▪");
    expect(SEVERITY_GLYPH.info).toBe("—");
  });
  it("orders severities critical → info", () => {
    expect(SEVERITY_ORDER).toEqual([
      "critical",
      "high",
      "medium",
      "low",
      "info",
    ]);
  });
  it("exposes a color per severity", () => {
    for (const s of SEVERITY_ORDER) {
      expect(SEVERITY_COLORS[s]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe("totalOf", () => {
  it("sums a bucket", () => {
    expect(
      totalOf({ critical: 1, high: 2, medium: 0, low: 3, info: 0 })
    ).toBe(6);
  });
});

describe("bucketLastSevenDays", () => {
  const now = new Date(2026, 8, 6, 12, 0, 0); // 2026-09-06 local
  const iso = (offsetDays: number, h = 10) => {
    const d = new Date(now);
    d.setDate(d.getDate() - offsetDays);
    d.setHours(h, 0, 0, 0);
    return d.toISOString();
  };

  it("buckets today's and yesterday's scans by day with their counts", () => {
    const scans = [
      scan({
        scan_id: "a",
        submitted_at: iso(0),
        severity_counts: { critical: 2, high: 1 },
      }),
      scan({
        scan_id: "b",
        submitted_at: iso(1),
        severity_counts: { high: 3 },
      }),
    ];
    const buckets = bucketLastSevenDays(scans, now);
    const today = buckets.find((b) => b.date.getDate() === now.getDate());
    const yesterday = buckets.find(
      (b) => b.date.getDate() === now.getDate() - 1
    );
    expect(today?.counts.critical).toBe(2);
    expect(today?.counts.high).toBe(1);
    expect(yesterday?.counts.high).toBe(3);
  });

  it("drops scans older than 7 days", () => {
    const scans = [
      scan({ scan_id: "old", submitted_at: iso(9), severity_counts: { high: 9 } }),
    ];
    const buckets = bucketLastSevenDays(scans, now);
    const total = buckets.reduce((acc, b) => acc + totalOf(b.counts), 0);
    expect(total).toBe(0);
  });

  it("ignores unparsable submitted_at", () => {
    const buckets = bucketLastSevenDays([scan({ scan_id: "x", submitted_at: "nope" })], now);
    expect(buckets).toHaveLength(7);
  });
});
