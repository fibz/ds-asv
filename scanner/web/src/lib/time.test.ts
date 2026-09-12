import { describe, expect, it } from "vitest";
import {
  daysAgo,
  formatDayLabel,
  formatElapsed,
  formatTimestamp,
  formatTimestampShort,
} from "./time";

describe("formatElapsed", () => {
  it("renders seconds under a minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(59)).toBe("59s");
  });
  it("renders minutes with seconds", () => {
    expect(formatElapsed(60)).toBe("1m 0s");
    expect(formatElapsed(12 * 60 + 4)).toBe("12m 4s");
  });
  it("renders hours as h mm", () => {
    expect(formatElapsed(3600)).toBe("1h 00m");
    expect(formatElapsed(3725)).toBe("1h 02m");
  });
  it("never returns a negative span", () => {
    expect(formatElapsed(-5)).toBe("0s");
  });
});

describe("formatTimestamp", () => {
  it("renders YYYY-MM-DD HH:MM from an ISO string", () => {
    // Local-time formatted: the parser and formatter use the same clock.
    const out = formatTimestamp("2026-09-06T10:21:00");
    expect(out).toMatch(/^2026-09-06 10:21$/);
  });
  it("handles null/undefined/garbage", () => {
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp(undefined)).toBe("—");
    expect(formatTimestamp("not-a-date")).toBe("—");
  });
});

describe("formatTimestampShort", () => {
  it("renders a compact day + time", () => {
    const out = formatTimestampShort("2026-09-06T10:21:00");
    expect(out).toMatch(/^06 Sep \d{2}:\d{2}$/);
  });
  it("handles missing input", () => {
    expect(formatTimestampShort(null)).toBe("—");
  });
});

describe("formatDayLabel", () => {
  it("renders 'Sep 3' style labels", () => {
    expect(formatDayLabel(new Date(2026, 8, 3))).toBe("Sep 3");
    expect(formatDayLabel(new Date(2026, 0, 28))).toBe("Jan 28");
  });
});

describe("daysAgo", () => {
  it("returns a whole-day count for a recent date", () => {
    const iso = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(daysAgo(iso)).toBe(3);
  });
  it("returns null for invalid input", () => {
    expect(daysAgo(null)).toBeNull();
    expect(daysAgo("garbage")).toBeNull();
  });
});
