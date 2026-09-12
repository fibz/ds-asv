import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/api/queries", () => ({
  useReports: vi.fn(),
  useScans: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScopeSets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScanFindings: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useAssets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useAudit: vi.fn(),
  useOrg: vi.fn(),
  keys: {},
}));

import { useReports, useScanFindings, useScans, useScopeSets } from "../lib/api/queries";
import { ApiError } from "../lib/api/client";
import { ReportDetail } from "./ReportDetail";

const report = {
  id: "r1", scanId: "s1", status: "attested", scopeVersionId: "v4",
  attestationId: "att1",
  attestation: { id: "att1", status: "attested", reason: null, reviewedAt: "2026-09-03" },
  summary: { hosts: 4, vulnerabilities: 9, averageRisk: 2.1, bySeverity: { "2": 7, "3": 2 }, compliance: "PASSED" },
  createdAt: "2026-09-03T00:00:00Z", updatedAt: "2026-09-03T00:00:00Z",
};

const version = { id: "v4", scopeSetId: "set1", versionNumber: 4, status: "approved", contentHash: null, submittedAt: null, approvedAt: "2026-08-01" };
const sets = { data: [{ id: "set1", name: "Production", description: null, createdAt: "2026-01-01", versions: [version] }], isLoading: false, error: null, refetch: vi.fn() };
const scan = { id: "s1", name: "Q3 external", status: "COMPLETED", startedAt: "2026-08-12T09:00:00Z", completedAt: "2026-08-12T09:44:00Z", createdAt: "2026-08-12T09:00:00Z", manifestIssuedAt: null, manifestExpiresAt: null };
const finding = (over: Record<string, unknown> = {}) => ({ id: "f1", scanId: "s1", assetId: "a1", qid: "12345", cveId: "CVE-2021-23017", severity: "high", pciSeverity: null, title: "nginx vulnerable", description: null, status: "open", ...over });

const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={["/reports/r1"]}>
      <Routes>
        <Route path="/reports/:reportId" element={<ReportDetail />} />
      </Routes>
    </MemoryRouter>
  );

describe("ReportDetail", () => {
  it("names the scan, keeps the backing scope version visible, and groups findings by severity", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(sets as never);
    vi.mocked(useScanFindings).mockReturnValue({ data: [finding(), finding({ id: "f2", severity: "low", title: "tls weak" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderDetail();

    expect(screen.getByRole("heading", { name: /Q3 external/ })).toBeInTheDocument();
    expect(screen.getByText(/Scope version Production v4/)).toHaveTextContent("Production v4");
    expect(screen.getByText(/High/)).toBeInTheDocument();
    expect(screen.getByText(/nginx vulnerable/)).toBeInTheDocument();
    expect(screen.getByText(/Low/)).toBeInTheDocument();
    expect(screen.getByText(/tls weak/)).toBeInTheDocument();
    // Finalisation gate is reused here.
    expect(screen.getByText("Finalisation gate")).toBeInTheDocument();
  });

  it("offers no dispute control — the write layer is not built yet", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(sets as never);
    vi.mocked(useScanFindings).mockReturnValue({ data: [finding()], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderDetail();

    expect(screen.queryByRole("button", { name: /dispute/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /dispute/i })).toBeNull();
  });

  it("skips the findings query when the scan id is unknown, and says the report is missing", () => {
    vi.mocked(useReports).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(sets as never);
    vi.mocked(useScanFindings).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderDetail();

    expect(useScanFindings).toHaveBeenCalledWith(null);
    expect(screen.getByText(/report could not be found/i)).toBeInTheDocument();
  });

  it("shows a skeleton while the report list loads, not the gate", () => {
    vi.mocked(useReports).mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() } as never);
    renderDetail();
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/Finalisation gate/i)).toBeNull();
  });

  it("renders an error state with a retry that refetches when the report list fails", async () => {
    const refetch = vi.fn();
    vi.mocked(useReports).mockReturnValue({ data: undefined, isLoading: false, error: new Error("x"), refetch } as never);
    renderDetail();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the permission state for a 403 instead of a read error with a retry", () => {
    vi.mocked(useReports).mockReturnValue({ data: undefined, isLoading: false, error: new ApiError("Forbidden", 403), refetch: vi.fn() } as never);
    renderDetail();
    expect(screen.getByText("report.view")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
