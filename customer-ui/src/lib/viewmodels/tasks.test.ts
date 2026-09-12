import { describe, it, expect } from "vitest";
import { quarterInfo, quarterTasks } from "./tasks";

describe("quarterInfo", () => {
  it("labels the quarter and counts down to its end", () => {
    const q = quarterInfo(new Date("2026-09-12T00:00:00Z"));
    expect(q.label).toBe("Q3 2026");
    expect(q.endsAt.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(q.daysRemaining).toBe(18);
  });
});

describe("quarterTasks", () => {
  it("returns the five lifecycle steps in order, with exactly one current", () => {
    const tasks = quarterTasks({ assets: [], approved: null, hasDraftScope: false, scans: [], reports: [], finalReportIds: [], now: new Date("2026-09-12T00:00:00Z") });
    expect(tasks.map((t) => t.index)).toEqual([1, 2, 3, 4, 5]);
    expect(tasks.filter((t) => t.current)).toHaveLength(1);
    expect(tasks[0].current).toBe(true);
    expect(tasks[0].state).toBe("pending");
    expect(tasks[1].state).toBe("pending");
  });

  it("locks later steps instead of hiding them, and strikes completed ones", () => {
    const tasks = quarterTasks({
      assets: [{ id: "a", type: "fqdn", canonicalIdentifier: "shop.example.com", displayName: null, owner: null, environment: null, criticality: "medium", lifecycleState: "active", verificationState: "verified", source: "manual", lastSeenAt: null, createdAt: "", updatedAt: "" }],
      approved: null, hasDraftScope: false, scans: [], reports: [], finalReportIds: [],
      now: new Date("2026-09-12T00:00:00Z"),
    });
    expect(tasks[0].state).toBe("complete");
    expect(tasks[1].state).not.toBe("complete");
    expect(tasks[4].state).toBe("pending");
    expect(tasks[4].title).toContain("report");
  });
});
