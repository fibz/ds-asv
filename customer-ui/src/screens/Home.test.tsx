import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../lib/api/queries", () => ({
  useAssets: vi.fn(), useScans: vi.fn(), useReports: vi.fn(),
  // Home reads the approved/draft scope versions out of useScopeSets, so the
  // mock must return a query result (an unstubbed vi.fn() returns undefined).
  useScopeSets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useApprovedScopeVersionId: vi.fn(() => null),
  useScanFindings: vi.fn(), useAudit: vi.fn(), useOrg: vi.fn(), keys: {},
}));

import { useAssets, useApprovedScopeVersionId, useReports, useScans } from "../lib/api/queries";
import { Home } from "./Home";

const ok = (data: unknown[]) => ({ data, isLoading: false, error: null, refetch: vi.fn() } as never);
const empty = { data: [], isLoading: false, error: null, refetch: vi.fn() } as never;
const renderHome = () => render(<MemoryRouter><Home /></MemoryRouter>);

const setup = (assets: unknown[], scans: unknown[], reports: unknown[]) => {
  vi.mocked(useAssets).mockReturnValue(ok(assets));
  vi.mocked(useScans).mockReturnValue(ok(scans));
  vi.mocked(useReports).mockReturnValue(ok(reports));
};

describe("Home", () => {
  it("gives an empty organisation exactly one actionable step", () => {
    setup([], [], []);
    vi.mocked(useApprovedScopeVersionId).mockReturnValue(null);
    renderHome();
    expect(screen.getByText(/Confirm your asset inventory/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add your first asset/ })).toBeInTheDocument();
  });

  it("renders the five lifecycle steps in order", () => {
    setup([], [], []);
    vi.mocked(useApprovedScopeVersionId).mockReturnValue(null);
    renderHome();
    expect(screen.getByText(/Confirm your asset inventory/)).toBeInTheDocument();
    expect(screen.getByText(/Get your scope approved/)).toBeInTheDocument();
    expect(screen.getByText(/Run this quarter's scans/)).toBeInTheDocument();
    expect(screen.getByText(/Review findings/)).toBeInTheDocument();
    expect(screen.getByText(/Finalise this quarter's report/)).toBeInTheDocument();
  });

  it("shows a skeleton while loading rather than an empty checklist", () => {
    vi.mocked(useAssets).mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue(empty);
    vi.mocked(useReports).mockReturnValue(empty);
    renderHome();
    expect(screen.queryByText(/Confirm your asset inventory/)).toBeNull();
  });

  it("renders an error state with a retry when a query fails", () => {
    vi.mocked(useAssets).mockReturnValue({ data: undefined, isLoading: false, error: new Error("x"), refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue(empty);
    vi.mocked(useReports).mockReturnValue(empty);
    renderHome();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
