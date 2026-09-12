import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/api/queries", () => ({
  useAssets: vi.fn(), useScans: vi.fn(), useReports: vi.fn(),
  // Home resolves report finality per report against the scope versions list
  // out of useScopeSets, so the mock must return a query result (an unstubbed
  // vi.fn() returns undefined). An empty versions list is the right default for
  // these cases — no report is final — and keeps the checklist/stats stable.
  useScopeSets: vi.fn(() => ({
    data: [{ id: "set-1", name: "Scope", versions: [] }],
    isLoading: false, error: null, refetch: vi.fn(),
  })),
  useScanFindings: vi.fn(), useAudit: vi.fn(), useOrg: vi.fn(), keys: {},
}));

import { useAssets, useReports, useScans } from "../lib/api/queries";
import { ApiError } from "../lib/api/client";
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
    renderHome();
    expect(screen.getByText(/Confirm your asset inventory/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add your first asset/ })).toBeInTheDocument();
  });

  it("renders the five lifecycle steps in order", () => {
    setup([], [], []);
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
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/Confirm your asset inventory/)).toBeNull();
  });

  it("renders an error state with a retry that refetches when a query fails", async () => {
    const refetch = vi.fn();
    vi.mocked(useAssets).mockReturnValue({ data: undefined, isLoading: false, error: new Error("x"), refetch } as never);
    vi.mocked(useScans).mockReturnValue(empty);
    vi.mocked(useReports).mockReturnValue(empty);
    renderHome();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the permission state for a 403 instead of a read error with a retry", () => {
    vi.mocked(useAssets).mockReturnValue({ data: undefined, isLoading: false, error: new ApiError("Forbidden", 403), refetch: vi.fn() } as never);
    vi.mocked(useScans).mockReturnValue(empty);
    vi.mocked(useReports).mockReturnValue(empty);
    renderHome();
    expect(screen.getByText("org.view")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
