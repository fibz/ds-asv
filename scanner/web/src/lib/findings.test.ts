import { describe, expect, it } from "vitest";
import type { Finding } from "../api/types";
import { filterBySeverity } from "./findings";
import { parseScope } from "./scope";

function finding(severity: Finding["severity"], title: string): Finding {
  return {
    id: title,
    target_id: "t",
    title,
    severity,
    source: "unauthenticated_banner",
    confidence: "uncertain",
    pci_fail: false,
    is_suppressed: false,
    created_at: "2026-09-06T00:00:00",
  };
}

describe("filterBySeverity", () => {
  const findings = [
    finding("critical", "critical one"),
    finding("high", "high one"),
    finding("medium", "medium one"),
    finding("low", "low one"),
    finding("info", "info one"),
  ];

  it("returns everything when no floor is set", () => {
    expect(filterBySeverity(findings, "")).toHaveLength(5);
  });

  it("keeps critical+high when the floor is high", () => {
    const out = filterBySeverity(findings, "high").map((f) => f.severity);
    expect(out).toEqual(["critical", "high"]);
  });

  it("keeps only critical when the floor is critical", () => {
    expect(filterBySeverity(findings, "critical")).toHaveLength(1);
  });

  it("keeps everything at the info floor", () => {
    expect(filterBySeverity(findings, "info")).toHaveLength(5);
  });
});

describe("parseScope", () => {
  it("parses a JSON array string of CIDRs", () => {
    expect(parseScope('["10.0.0.0/24","203.0.113.5"]')).toEqual([
      "10.0.0.0/24",
      "203.0.113.5",
    ]);
  });
  it("returns [] for null/undefined/garbage", () => {
    expect(parseScope(null)).toEqual([]);
    expect(parseScope(undefined)).toEqual([]);
    expect(parseScope("not json")).toEqual([]);
    expect(parseScope('{"a":1}')).toEqual([]);
  });
  it("filters non-strings", () => {
    expect(parseScope('[1,"10.0.0.1"]')).toEqual(["10.0.0.1"]);
  });
});
