import { describe, expect, it } from "vitest";
import { reviewWorkspaceSections } from "./ReviewWorkspace";
import type { QsaReviewView } from "@/lib/qsa/review";

const view = {
  assignment: { id: "a1", qsaOrganizationId: "qsa", customerOrganizationId: "customer", reportId: "r1", assigneeUserId: "u1", createdByUserId: "u1", status: "in_review", dueAt: null, notes: "Internal", claimedAt: null, completedAt: null, cancelledAt: null, createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z" },
  customer: { id: "customer", name: "Customer" },
  report: { id: "r1", status: "submitted", summary: {}, createdAt: "2026-09-09T00:00:00.000Z", attestation: null },
  scan: { id: "s1", name: "Scan", status: "COMPLETED", targets: [] },
  scope: null,
  findings: [],
  disputes: [],
  isFinal: false,
} satisfies QsaReviewView;

describe("QSA review workspace", () => {
  it("summarizes assignment evidence without customer controls", () => {
    expect(reviewWorkspaceSections(view)).toEqual(["Customer: Customer", "Report: submitted", "Scope: not attached", "Findings: 0", "Disputes: 0", "Final: no"]);
  });
});
