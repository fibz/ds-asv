import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/api/queries", () => ({
  useAssets: vi.fn(),
  useScans: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useReports: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScopeSets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScanFindings: vi.fn(), useAudit: vi.fn(), useOrg: vi.fn(), keys: {},
}));

import { useAssets } from "../lib/api/queries";
import { Assets } from "./Assets";

const asset = (over = {}) => ({ id: "a1", type: "fqdn", canonicalIdentifier: "shop.example.com", displayName: null, owner: null, environment: null, criticality: "medium", lifecycleState: "active", verificationState: "verified", source: "manual", lastSeenAt: null, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z", ...over });
const renderAssets = () => render(<MemoryRouter><Assets /></MemoryRouter>);

describe("Assets", () => {
  it("offers the two ways in when the inventory is empty", () => {
    vi.mocked(useAssets).mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderAssets();
    expect(screen.getByText(/No assets yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Import CSV/i })).toHaveAttribute("href", "/assets/import");
    expect(screen.getByRole("link", { name: /Add asset/i })).toHaveAttribute("href", "/assets/new");
  });

  it("sorts unverified assets first", () => {
    vi.mocked(useAssets).mockReturnValue({ data: [asset({ id: "v" }), asset({ id: "u", canonicalIdentifier: "api.example.com", verificationState: "unverified" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderAssets();
    const cards = screen.getAllByTestId("record-card");
    expect(cards[0]).toHaveTextContent("api.example.com");
  });

  it("filters by identifier", async () => {
    vi.mocked(useAssets).mockReturnValue({ data: [asset(), asset({ id: "b", canonicalIdentifier: "pay.example.com" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderAssets();
    await userEvent.type(screen.getByRole("searchbox"), "pay");
    expect(screen.getAllByTestId("record-card")).toHaveLength(1);
  });

  it("keeps retired assets visible in their own section", () => {
    vi.mocked(useAssets).mockReturnValue({ data: [asset(), asset({ id: "r", canonicalIdentifier: "old.example.com", lifecycleState: "retired" })], isLoading: false, error: null, refetch: vi.fn() } as never);
    renderAssets();
    expect(screen.getByText(/Retired/i)).toBeInTheDocument();
    expect(screen.getByText("old.example.com")).toBeInTheDocument();
  });

  it("shows a skeleton while loading and an error state with a retry on failure", () => {
    vi.mocked(useAssets).mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() } as never);
    const { unmount } = renderAssets();
    expect(screen.queryByText(/No assets yet/i)).toBeNull();
    unmount();
    vi.mocked(useAssets).mockReturnValue({ data: undefined, isLoading: false, error: new Error("x"), refetch: vi.fn() } as never);
    renderAssets();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
