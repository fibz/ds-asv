import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/api/queries", () => ({
  useScans: vi.fn(),
  useScopeSets: vi.fn(),
  useAssets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useReports: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScanFindings: vi.fn(), useAudit: vi.fn(), useOrg: vi.fn(), keys: {},
}));

import { useScans, useScopeSets } from "../lib/api/queries";
import { ApiError } from "../lib/api/client";
import { Scans } from "./Scans";

const scan = (over = {}) => ({ id: "s1", name: "Q3 external", status: "COMPLETED", startedAt: "2026-08-12T09:00:00Z", completedAt: "2026-08-12T09:44:00Z", createdAt: "2026-08-12T09:00:00Z", manifestIssuedAt: null, manifestExpiresAt: null, ...over });
const scopeSet = { id: "set1", name: "Production", description: null, createdAt: "", versions: [] };
const approvedScopeSet = {
  id: "set1", name: "Production", description: null, createdAt: "",
  versions: [{ id: "v1", scopeSetId: "set1", versionNumber: 1, status: "approved", contentHash: null, submittedAt: null, approvedAt: "2026-08-01" }],
};
const renderScans = () => render(<MemoryRouter><Scans /></MemoryRouter>);

// The primary variant is the accent-filled control. The screen must show exactly
// one - the header "New scan" - and never a second filled action beside it.
const primaryStyled = () =>
  Array.from(document.querySelectorAll("button, a")).filter((el) =>
    /bg-\[var\(--accent\)\]/.test(el.className)
  );

describe("Scans", () => {
  it("explains why a new scan is not possible instead of silently disabling it", () => {
    vi.mocked(useScans).mockReturnValue({ data: [scan()], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderScans();
    expect(screen.getByRole("button", { name: /New scan/i })).toBeDisabled();
    expect(screen.getByText(/approved scope is required/i)).toBeInTheDocument();
  });

  it("points the disabled button at the visible reason so it is announced too", () => {
    vi.mocked(useScans).mockReturnValue({ data: [scan()], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderScans();
    const describedBy = screen.getByRole("button", { name: /New scan/i }).getAttribute("aria-describedby");
    expect(describedBy).toBe("new-scan-reason");
    expect(document.getElementById(describedBy as string)?.textContent).toMatch(/approved scope is required/i);
  });

  it("shows status as a word plus a glyph, not colour alone", () => {
    vi.mocked(useScans).mockReturnValue({ data: [scan({ status: "FAILED" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [scopeSet], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderScans();
    expect(screen.getByText(/Failed/)).toBeInTheDocument();
  });

  it("marks a running scan as running", () => {
    vi.mocked(useScans).mockReturnValue({ data: [scan({ status: "RUNNING" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [scopeSet], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderScans();
    expect(screen.getByText(/Running/)).toBeInTheDocument();
  });

  it("says so plainly when there are no scans, and offers the next step", () => {
    vi.mocked(useScans).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [scopeSet], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderScans();
    expect(screen.getByText(/No scans yet/i)).toBeInTheDocument();
  });

  it("shows a skeleton while loading and an error state with a retry on failure", async () => {
    vi.mocked(useScans).mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [scopeSet], isLoading: false, error: null, refetch: vi.fn() } as never);
    const { unmount } = renderScans();
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/No scans yet/i)).toBeNull();
    unmount();
    const refetch = vi.fn();
    vi.mocked(useScans).mockReturnValue({ data: undefined, isLoading: false, error: new Error("x"), refetch } as never);
    renderScans();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the permission state for a 403 instead of a read error with a retry", () => {
    vi.mocked(useScans).mockReturnValue({ data: undefined, isLoading: false, error: new ApiError("Forbidden", 403), refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [scopeSet], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderScans();
    expect(screen.getByText("scan.view")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps exactly one primary control when the list is empty and no scope is approved", () => {
    vi.mocked(useScans).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderScans();

    // "New scan" (disabled here) is the screen's single filled control; the
    // empty-state next step is the outline variant, so the two never compete.
    const primaries = primaryStyled();
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent(/New scan/i);

    const openScope = screen.getByRole("link", { name: /Open scope/i });
    expect(openScope.className).not.toMatch(/bg-\[var\(--accent\)\]/);
    expect(openScope.className).toMatch(/border/);
  });

  it("keeps the enabled New scan as the only primary when the list is empty and a scope is approved", () => {
    vi.mocked(useScans).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [approvedScopeSet], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderScans();

    const newScan = screen.getByRole("button", { name: /New scan/i });
    expect(newScan).toBeEnabled();
    const primaries = primaryStyled();
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toBe(newScan);

    expect(screen.getByRole("link", { name: /Open scope/i }).className).not.toMatch(/bg-\[var\(--accent\)\]/);
  });

  it("keeps exactly one primary control when the list has scans", () => {
    vi.mocked(useScans).mockReturnValue({ data: [scan(), scan({ id: "s2" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useScopeSets).mockReturnValue({ data: [approvedScopeSet], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderScans();
    expect(primaryStyled()).toHaveLength(1);
    expect(screen.queryByText(/No scans yet/i)).toBeNull();
  });
});
