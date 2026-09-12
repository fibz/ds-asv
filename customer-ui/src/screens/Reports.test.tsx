import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../lib/api/queries", () => ({
  useReports: vi.fn(),
  useScans: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScopeSets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useAssets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScanFindings: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useAudit: vi.fn(),
  useOrg: vi.fn(),
  keys: {},
}));

import { useReports, useScans, useScopeSets } from "../lib/api/queries";
import { Reports } from "./Reports";

const report = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  scanId: "s1",
  status: "submitted",
  scopeVersionId: "v4",
  attestationId: "att1",
  attestation: { id: "att1", status: "submitted", reason: null, reviewedAt: null },
  summary: { hosts: 4, vulnerabilities: 9, averageRisk: 2.1, bySeverity: { "2": 7, "3": 2 }, compliance: "PASSED" },
  createdAt: "2026-09-03T00:00:00Z",
  updatedAt: "2026-09-03T00:00:00Z",
  ...over,
});

const attestedAttestation = { id: "att1", status: "attested", reason: null, reviewedAt: "2026-09-03" };

// A version nested inside /scope-sets, exactly as the API returns it.
const version = (id: string, versionNumber: number, status: string) => ({
  id,
  scopeSetId: "set1",
  versionNumber,
  status,
  contentHash: null,
  submittedAt: null,
  approvedAt: status === "approved" ? "2026-08-01" : null,
});

const scopeSets = (...versions: unknown[]) => ({
  data: [{ id: "set1", name: "Production", description: null, createdAt: "2026-01-01", versions }],
  isLoading: false,
  error: null,
  refetch: vi.fn(),
});

const scan = { id: "s1", name: "Q3 external", status: "COMPLETED", startedAt: "2026-08-12T09:00:00Z", completedAt: "2026-08-12T09:44:00Z", createdAt: "2026-08-12T09:00:00Z", manifestIssuedAt: null, manifestExpiresAt: null };

const renderReports = () => render(<MemoryRouter><Reports /></MemoryRouter>);
const state = () => screen.getByTestId("report-state-r1");

describe("Reports", () => {
  it("does not label a submitted report final even though it records an approved scope version", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report()], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets(version("v4", 4, "approved")) as never);
    renderReports();
    expect(state()).not.toHaveTextContent("Final");
    expect(state()).toHaveTextContent("Awaiting attestation");
    expect(screen.getByText(/Attestation pending/)).toBeInTheDocument();
  });

  it("labels an attested report whose scope version is approved as Final", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report({ status: "attested", attestation: attestedAttestation })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets(version("v4", 4, "approved")) as never);
    renderReports();
    expect(state()).toHaveTextContent("Final");
  });

  it("keeps an attested report backed by an OLDER approved version final (server-matching rule)", () => {
    // v4 is the newest approved version; the report records v3, which is ALSO
    // approved. A naive newest-version comparison would wrongly withhold
    // finality here — the server calls this report final, and so must we.
    vi.mocked(useReports).mockReturnValue({ data: [report({ status: "attested", scopeVersionId: "v3", attestation: attestedAttestation })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets(version("v3", 3, "approved"), version("v4", 4, "approved")) as never);
    renderReports();
    expect(state()).toHaveTextContent("Final");
  });

  it("withholds finality when the report's own version was never approved", () => {
    // The report records v4, which was never approved (only v5 was) — no finality.
    vi.mocked(useReports).mockReturnValue({ data: [report({ status: "attested", attestation: attestedAttestation })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets(version("v5", 5, "approved")) as never);
    renderReports();
    expect(state()).not.toHaveTextContent("Final");
  });

  it("shows the four gate steps derived from this report, and the backing scope version", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report({ status: "attested", attestation: attestedAttestation })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets(version("v4", 4, "approved")) as never);
    renderReports();
    expect(screen.getByTestId("step-Scan complete")).toHaveAttribute("data-state", "complete");
    expect(screen.getByTestId("step-Findings in")).toHaveAttribute("data-state", "complete");
    expect(screen.getByTestId("step-Attested")).toHaveAttribute("data-state", "complete");
    expect(screen.getByTestId("step-Final")).toHaveAttribute("data-state", "complete");
    expect(screen.getByText(/Scope version Production v4/)).toHaveTextContent("Production v4");
  });

  it("links each card into its report detail", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report()], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets(version("v4", 4, "approved")) as never);
    renderReports();
    expect(screen.getByRole("link", { name: /Open report/i })).toHaveAttribute("href", "/reports/r1");
  });

  it("orders reports newest first", () => {
    vi.mocked(useReports).mockReturnValue({
      data: [
        report({ id: "old", createdAt: "2026-06-01T00:00:00Z" }),
        report({ id: "new", createdAt: "2026-09-01T00:00:00Z" }),
      ],
      isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets(version("v4", 4, "approved")) as never);
    renderReports();
    const cards = screen.getAllByTestId("report-card");
    expect(cards[0].textContent).toContain("Q3 2026");
  });

  it("shows a skeleton while loading rather than an empty state", () => {
    vi.mocked(useReports).mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets() as never);
    renderReports();
    expect(screen.queryByText(/No reports yet/i)).toBeNull();
  });

  it("says so plainly with a next step when there are no reports", () => {
    vi.mocked(useReports).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets() as never);
    renderReports();
    expect(screen.getByText(/No reports yet/i)).toBeInTheDocument();
  });

  it("renders an error state with a retry when the query fails", () => {
    vi.mocked(useReports).mockReturnValue({ data: undefined, isLoading: false, error: new Error("x"), refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets() as never);
    renderReports();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
