import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/api/queries", () => ({
  useReports: vi.fn(),
  useGenerateReport: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
  useScans: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScopeSets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useAssets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScanFindings: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useAudit: vi.fn(),
  useOrg: vi.fn(),
  keys: {},
}));

import { useGenerateReport, useReports, useScans, useScopeSets } from "../lib/api/queries";
import { ApiError } from "../lib/api/client";
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

// The primary variant is the accent-filled control. A screen must show at most
// one; the per-report download must never be it.
const primaryStyled = () =>
  Array.from(document.querySelectorAll("button, a")).filter((el) =>
    /bg-\[var\(--accent\)\]/.test(el.className)
  );

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
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/No reports yet/i)).toBeNull();
  });

  it("says so plainly with a next step when there are no reports", () => {
    vi.mocked(useReports).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets() as never);
    renderReports();
    expect(screen.getByText(/No reports yet/i)).toBeInTheDocument();
  });

  it("renders an error state with a retry that refetches when the query fails", async () => {
    const refetch = vi.fn();
    vi.mocked(useReports).mockReturnValue({ data: undefined, isLoading: false, error: new Error("x"), refetch } as never);
    vi.mocked(useScans).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets() as never);
    renderReports();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the permission state for a 403 instead of a read error with a retry", () => {
    vi.mocked(useReports).mockReturnValue({ data: undefined, isLoading: false, error: new ApiError("Forbidden", 403), refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets() as never);
    renderReports();
    expect(screen.getByText("report.view")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still offers the download on a final report, as the secondary (outline) control", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report({ status: "attested", attestation: attestedAttestation })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets(version("v4", 4, "approved")) as never);
    renderReports();

    const download = screen.getByRole("link", { name: /Download PDF/i });
    expect(download).toHaveAttribute("href", "/api/v1/reports/r1/download");
    // One primary action per screen: a list of reports is not five filled buttons.
    expect(download.className).not.toMatch(/bg-\[var\(--accent\)\]/);
    expect(download.className).toMatch(/border/);
    expect(primaryStyled()).toHaveLength(0);
  });

  it("withholds the download until the gate says the report is final", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report()], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue(scopeSets(version("v4", 4, "approved")) as never);
    renderReports();
    expect(screen.queryByRole("link", { name: /Download PDF/i })).toBeNull();
  });
});

/**
 * A scan row's "Findings →" links here with ?scan=<id>. Before this, that click
 * landed on the generic "No reports yet" empty state — true, but a dead end:
 * it neither named the scan nor offered the action that produces the report.
 */
describe("Reports — arriving from a scan", () => {
  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Reports />
      </MemoryRouter>
    );

  const noReports = () =>
    vi.mocked(useReports).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
  const completedScan = () =>
    vi.mocked(useScans).mockReturnValue({ data: [scan], isLoading: false, error: null, refetch: vi.fn() } as never);
  const generate = (over: Record<string, unknown> = {}) =>
    vi.mocked(useGenerateReport).mockReturnValue({ mutate: vi.fn(), isPending: false, error: null, ...over } as never);

  it("names the scan and offers to generate its report", () => {
    noReports(); completedScan(); generate();
    vi.mocked(useScopeSets).mockReturnValue(scopeSets() as never);
    renderAt("/reports?scan=s1");
    expect(screen.getByText(/No report for Q3 external yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate report/i })).toBeEnabled();
    // The generic empty state would restate the problem without the way out.
    expect(screen.queryByText(/No reports yet/)).toBeNull();
  });

  it("sends the scan id when the reader asks for the report", async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();
    noReports(); completedScan(); generate({ mutate });
    vi.mocked(useScopeSets).mockReturnValue(scopeSets() as never);
    renderAt("/reports?scan=s1");
    await user.click(screen.getByRole("button", { name: /Generate report/i }));
    expect(mutate).toHaveBeenCalledWith("s1");
  });

  it("does not offer generation once that scan already has a report", () => {
    vi.mocked(useReports).mockReturnValue({ data: [report({ scanId: "s1" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    completedScan(); generate();
    vi.mocked(useScopeSets).mockReturnValue(scopeSets(version("v4", 4, "approved")) as never);
    renderAt("/reports?scan=s1");
    expect(screen.queryByTestId("generate-report")).toBeNull();
  });

  it("will not generate for a scan that has not completed", () => {
    noReports();
    vi.mocked(useScans).mockReturnValue({ data: [{ ...scan, status: "RUNNING" }], isLoading: false, error: null, refetch: vi.fn() } as never);
    generate();
    vi.mocked(useScopeSets).mockReturnValue(scopeSets() as never);
    renderAt("/reports?scan=s1");
    expect(screen.getByRole("button", { name: /Generate report/i })).toBeDisabled();
    expect(screen.getByText(/hasn’t completed yet/i)).toBeInTheDocument();
  });

  it("calls a 403 generation failure a permission wall, not a retry", () => {
    noReports(); completedScan();
    generate({ error: new ApiError("Forbidden", 403) });
    vi.mocked(useScopeSets).mockReturnValue(scopeSets() as never);
    renderAt("/reports?scan=s1");
    expect(screen.getByRole("alert")).toHaveTextContent(/don’t have permission/i);
  });

  it("shows nothing extra when the reader arrives without a scan", () => {
    noReports(); completedScan(); generate();
    vi.mocked(useScopeSets).mockReturnValue(scopeSets() as never);
    renderAt("/reports");
    expect(screen.queryByTestId("generate-report")).toBeNull();
    expect(screen.getByText(/No reports yet/)).toBeInTheDocument();
  });
});
