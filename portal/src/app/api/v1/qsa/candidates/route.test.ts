import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const auth = vi.hoisted(() => ({ qsaAuth: vi.fn() }));
const service = vi.hoisted(() => ({ listQsaCandidateReports: vi.fn() }));
vi.mock("@/lib/qsa/http", () => ({ qsaAuth: auth.qsaAuth }));
vi.mock("@/lib/qsa/assignment", () => ({ listQsaCandidateReports: service.listQsaCandidateReports }));

import { GET } from "./route";

describe("GET /api/v1/qsa/candidates", () => {
  it("returns the shared auth response for unauthenticated requests", async () => {
    auth.qsaAuth.mockResolvedValueOnce({ response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await GET(new NextRequest("http://localhost/api/v1/qsa/candidates"));
    expect(response.status).toBe(401);
    expect(service.listQsaCandidateReports).not.toHaveBeenCalled();
  });

  it("returns minimal candidate metadata for an authorized reviewer", async () => {
    const ctx = { userId: "u1", organizationId: "qsa", role: "report_viewer", isStaff: true, appMode: "test" };
    auth.qsaAuth.mockResolvedValueOnce({ ctx });
    service.listQsaCandidateReports.mockResolvedValueOnce([{ reportId: "r1", customerOrganizationId: "c1", customerName: "Customer", reportStatus: "submitted", createdAt: "2026-09-09T00:00:00.000Z" }]);
    const response = await GET(new NextRequest("http://localhost/api/v1/qsa/candidates"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ candidates: [{ reportId: "r1", customerOrganizationId: "c1", customerName: "Customer", reportStatus: "submitted", createdAt: "2026-09-09T00:00:00.000Z" }] });
  });
});
