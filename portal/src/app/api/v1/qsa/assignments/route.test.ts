import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ qsaAuth: vi.fn() }));
const service = vi.hoisted(() => ({ createQsaAssignment: vi.fn(), listQsaAssignments: vi.fn() }));
vi.mock("@/lib/qsa/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/qsa/http")>("@/lib/qsa/http");
  return { ...actual, qsaAuth: auth.qsaAuth };
});
vi.mock("@/lib/qsa/assignment", () => ({ createQsaAssignment: service.createQsaAssignment, listQsaAssignments: service.listQsaAssignments }));

import { GET, POST } from "./route";

const ctx = { userId: "u1", organizationId: "qsa", role: "report_viewer", isStaff: true, appMode: "test" };

describe("QSA assignment routes", () => {
  it("rejects malformed create input before calling the service", async () => {
    auth.qsaAuth.mockResolvedValueOnce({ ctx });
    const response = await POST(new NextRequest("http://localhost/api/v1/qsa/assignments", { method: "POST", body: JSON.stringify({}) }));
    expect(response.status).toBe(400);
    expect(service.createQsaAssignment).not.toHaveBeenCalled();
  });

  it("creates a direct assignment with validated dates", async () => {
    auth.qsaAuth.mockResolvedValueOnce({ ctx });
    service.createQsaAssignment.mockResolvedValueOnce({ id: "a1", status: "assigned" });
    const response = await POST(new NextRequest("http://localhost/api/v1/qsa/assignments", {
      method: "POST",
      body: JSON.stringify({ reportId: "r1", assigneeUserId: "u2", dueAt: "2026-09-10T00:00:00.000Z" }),
    }));
    expect(response.status).toBe(201);
    expect(service.createQsaAssignment).toHaveBeenCalledWith(ctx, expect.objectContaining({ reportId: "r1", assigneeUserId: "u2", dueAt: expect.any(Date) }));
  });

  it("lists assignments with a valid status filter", async () => {
    auth.qsaAuth.mockResolvedValueOnce({ ctx });
    service.listQsaAssignments.mockResolvedValueOnce([]);
    const response = await GET(new NextRequest("http://localhost/api/v1/qsa/assignments?status=in_review"));
    expect(response.status).toBe(200);
    expect(service.listQsaAssignments).toHaveBeenCalledWith(ctx, { status: "in_review" });
  });
});
