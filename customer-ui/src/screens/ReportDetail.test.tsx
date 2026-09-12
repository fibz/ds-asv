import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/api/queries", () => ({
  useReports: vi.fn(),
  useScans: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScopeSets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScanFindings: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useRaiseDispute: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null, isSuccess: false })),
  useAssets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useAudit: vi.fn(),
  useOrg: vi.fn(),
  keys: {},
}));

import { useRaiseDispute, useReports, useScanFindings, useScans, useScopeSets } from "../lib/api/queries";
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

  it("offers no dispute control on a finding that is no longer open", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(sets as never);
    vi.mocked(useScanFindings).mockReturnValue({ data: [finding({ status: "mitigated" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useRaiseDispute).mockReturnValue({ mutate: vi.fn(), isPending: false, error: null, isSuccess: false } as never);
    renderDetail();

    expect(screen.queryByRole("button", { name: /raise dispute/i })).toBeNull();
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

describe("ReportDetail — raising a dispute", () => {
  const mockDispute = (over: object = {}) => {
    const base = { mutate: vi.fn(), isPending: false, error: null, isSuccess: false, variables: undefined };
    vi.mocked(useRaiseDispute).mockReturnValue({ ...base, ...over } as never);
    return base;
  };

  const renderWith = (findings: unknown[]) => {
    vi.mocked(useReports).mockReturnValue({ data: [report], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(sets as never);
    vi.mocked(useScanFindings).mockReturnValue({ data: findings, isLoading: false, error: null, refetch: vi.fn() } as never);
    renderDetail();
  };

  const openForm = async () => {
    await userEvent.click(screen.getByRole("button", { name: /^Raise dispute$/i }));
  };

  it("offers the control once per finding, and only while the finding is open", () => {
    mockDispute();
    renderWith([
      finding(),
      finding({ id: "f2", title: "tls weak", severity: "low" }),
      finding({ id: "f3", title: "already mitigated", severity: "low", status: "mitigated" }),
    ]);
    expect(screen.getAllByRole("button", { name: /^Raise dispute$/i })).toHaveLength(2);
  });

  it("refuses an empty justification — it does not call the mutation and says why", async () => {
    const { mutate } = mockDispute();
    renderWith([finding()]);
    await openForm();

    await userEvent.click(screen.getByRole("button", { name: /Submit dispute/i }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/justification is required/i)).toBeInTheDocument();
  });

  it("submits the justification under the field name the route reads", async () => {
    const { mutate } = mockDispute();
    renderWith([finding()]);
    await openForm();

    await userEvent.type(screen.getByLabelText(/justification/i), "Not reachable from the internet");
    await userEvent.click(screen.getByRole("button", { name: /Submit dispute/i }));

    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", justification: "Not reachable from the internet" });
  });

  it("disables the control and shows a pending label while the dispute is in flight", async () => {
    mockDispute({ isPending: true });
    renderWith([finding()]);
    await openForm();

    expect(screen.getByRole("button", { name: /Submitting/i })).toBeDisabled();
  });

  it("gives the textarea a real label and associates the error with it", async () => {
    mockDispute({ error: new ApiError("That conflicts with something that already exists.", 409) });
    renderWith([finding()]);
    await openForm();

    const textarea = screen.getByLabelText(/justification/i);
    const alert = screen.getByRole("alert");
    expect(alert.id).not.toBe("");
    expect((textarea.getAttribute("aria-describedby") ?? "").split(" ")).toContain(alert.id);
  });

  it("confirms on the finding and closes the form once the dispute is raised", async () => {
    mockDispute({ isSuccess: true, variables: { findingId: "f1", justification: "x" } });
    renderWith([finding()]);

    expect(screen.getByText(/Dispute raised/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Raise dispute$/i })).toBeNull();
  });

  it("explains a 403 as a missing finding.dispute permission, not a generic failure", async () => {
    mockDispute({ error: new ApiError("Your role does not allow this action. Ask an organisation owner if you need access.", 403) });
    renderWith([finding()]);
    await openForm();

    expect(screen.getByText("finding.dispute")).toBeInTheDocument();
    expect(screen.queryByText(/Your role does not allow/)).toBeNull();
  });

  it("shows a sanitised api error next to the form for anything other than 403", async () => {
    mockDispute({ error: new ApiError("That conflicts with something that already exists.", 409) });
    renderWith([finding()]);
    await openForm();

    expect(screen.getByRole("alert")).toHaveTextContent(/conflicts/i);
    expect(screen.getByRole("button", { name: /Submit dispute/i })).toBeInTheDocument();
  });
});
