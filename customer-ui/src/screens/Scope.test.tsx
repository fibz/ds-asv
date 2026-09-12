import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/api/queries", () => ({
  useScopeSets: vi.fn(),
  useSubmitScopeVersion: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
  useIssueAuthorization: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null, isSuccess: false })),
  useAssets: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScans: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useReports: vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() })),
  useScanFindings: vi.fn(), useAudit: vi.fn(), useOrg: vi.fn(), keys: {},
}));

import { useScopeSets, useSubmitScopeVersion, useIssueAuthorization } from "../lib/api/queries";
import { ApiError } from "../lib/api/client";
import { Scope } from "./Scope";

const set = (versions: unknown[]) => ({ id: "set1", name: "Production", description: null, createdAt: "", versions });
const version = (over = {}) => ({
  id: "v4", scopeSetId: "set1", versionNumber: 4, status: "approved", contentHash: "9f2ca41d2e5b",
  submittedAt: "2026-08-01T00:00:00Z", approvedAt: "2026-08-04T00:00:00Z", _count: { items: 4 }, ...over,
});

const mockSets = (sets: unknown[]) =>
  vi.mocked(useScopeSets).mockReturnValue({ data: sets, isLoading: false, error: null, refetch: vi.fn() } as never);
const mockSubmit = (over: object) =>
  vi.mocked(useSubmitScopeVersion).mockReturnValue({ mutate: vi.fn(), isPending: false, error: null, ...over } as never);
const mockIssue = (over: object) =>
  vi.mocked(useIssueAuthorization).mockReturnValue({ mutate: vi.fn(), isPending: false, error: null, isSuccess: false, variables: undefined, data: undefined, ...over } as never);

const authorisation = {
  id: "auth1", organizationId: "org1", scopeVersionId: "v4",
  statementHash: "aa11bb22cc33dd44", scopeVersionHash: "ee55ff66aa77bb88",
  signature: "9f2ca41d2e5b0000deadbeef0000cafe0000123456789abcdef00ff00ff00ff00",
  status: "issued", issuedById: "u1", issuedAt: "2026-09-12T00:00:00Z", createdAt: "2026-09-12T00:00:00Z",
};

const renderScope = () => render(<MemoryRouter><Scope /></MemoryRouter>);

describe("Scope", () => {
  // The issue hook's return value persists between tests once mockReturnValue
  // has been called; reset it so each test states its own state explicitly.
  beforeEach(() => { mockIssue({}); });

  it("says so plainly when nothing is approved, and does not claim coverage", () => {
    mockSets([]);
    renderScope();
    expect(screen.getByText(/No approved scope/i)).toBeInTheDocument();
    // No coverage claim: neither "in force" nor an asset count is rendered.
    expect(screen.queryByText(/in force/i)).toBeNull();
    expect(screen.queryByText(/\d+\s+assets/i)).toBeNull();
  });

  it("renders the hero for an approved version with its item count from _count", () => {
    mockSets([set([version()])]);
    renderScope();
    expect(screen.getByText(/v4/)).toBeInTheDocument();
    expect(screen.getByText(/4 assets/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-04/)).toBeInTheDocument();
    expect(screen.getByText("9f2ca41d")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View assets/i })).toHaveAttribute("href", "/assets");
  });

  it("omits the item count rather than inventing one when _count is absent", () => {
    mockSets([set([version({ _count: undefined })])]);
    renderScope();
    expect(screen.queryByText(/\d+\s+assets/i)).toBeNull();
  });

  it("renders the draft banner with a submit action when a draft exists", () => {
    mockSets([set([version(), version({ id: "v5", versionNumber: 5, status: "draft", approvedAt: null })])]);
    renderScope();
    expect(screen.getByText(/not in force/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit for approval/i })).toBeEnabled();
  });

  it("calls the mutate function with the draft version id when submit is clicked", async () => {
    const mutate = vi.fn();
    mockSets([set([version(), version({ id: "v5", versionNumber: 5, status: "draft", approvedAt: null })])]);
    mockSubmit({ mutate });
    renderScope();
    await userEvent.click(screen.getByRole("button", { name: /Submit for approval/i }));
    expect(mutate).toHaveBeenCalledWith("v5");
  });

  it("disables the control and shows a pending label while the submit is in flight", () => {
    mockSets([set([version(), version({ id: "v5", versionNumber: 5, status: "draft", approvedAt: null })])]);
    mockSubmit({ isPending: true });
    renderScope();
    expect(screen.getByRole("button", { name: /Submitting/i })).toBeDisabled();
  });

  it("renders the permission state for a 403 instead of a raw error", () => {
    mockSets([set([version(), version({ id: "v5", versionNumber: 5, status: "draft", approvedAt: null })])]);
    mockSubmit({ error: new ApiError("Your role does not allow this action. Ask an organisation owner if you need access.", 403) });
    renderScope();
    expect(screen.getByText("scope.manage")).toBeInTheDocument();
    expect(screen.queryByText(/Your role does not allow/)).toBeNull();
  });

  it("surfaces a non-403 mutation error near the action without breaking the screen", () => {
    mockSets([set([version(), version({ id: "v5", versionNumber: 5, status: "draft", approvedAt: null })])]);
    mockSubmit({ error: new ApiError("That conflicts with something that already exists.", 409) });
    renderScope();
    expect(screen.getByRole("alert")).toHaveTextContent(/conflicts/i);
    // The screen stays usable: the action is still there.
    expect(screen.getByRole("button", { name: /Submit for approval/i })).toBeInTheDocument();
  });

  it("lists superseded versions in history, marked as superseded", () => {
    mockSets([set([version({ id: "v2", versionNumber: 2, status: "approved" }), version()])]);
    renderScope();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
    expect(screen.getByText(/Superseded/i)).toBeInTheDocument();
  });

  it("shows a skeleton while loading and an error state with a retry on failure", async () => {
    vi.mocked(useScopeSets).mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() } as never);
    const { unmount } = renderScope();
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/No approved scope/i)).toBeNull();
    unmount();

    const refetch = vi.fn();
    vi.mocked(useScopeSets).mockReturnValue({ data: undefined, isLoading: false, error: new Error("x"), refetch } as never);
    renderScope();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the permission state when the scope read itself is forbidden", () => {
    vi.mocked(useScopeSets).mockReturnValue({ data: undefined, isLoading: false, error: new ApiError("Forbidden", 403), refetch: vi.fn() } as never);
    renderScope();
    expect(screen.getByText("scope.view")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers the issue control on the approved version and posts that version's id", async () => {
    mockSets([set([version()])]);
    const mutate = vi.fn();
    mockIssue({ mutate });
    renderScope();

    await userEvent.click(screen.getByRole("button", { name: /Issue authorisation/i }));
    expect(mutate).toHaveBeenCalledWith("v4");
  });

  it("disables the control and shows a pending label while issuing", () => {
    mockSets([set([version()])]);
    mockIssue({ isPending: true });
    renderScope();
    expect(screen.getByRole("button", { name: /Issuing/i })).toBeDisabled();
  });

  it("shows the signed statement readably with a save action once issued", () => {
    mockSets([set([version()])]);
    mockIssue({ isSuccess: true, variables: "v4", data: { authorization: authorisation } });
    renderScope();

    expect(screen.getByText("Issued")).toBeInTheDocument();
    expect(screen.getByText("2026-09-12")).toBeInTheDocument();
    expect(screen.getByText(authorisation.signature)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save authorisation/i })).toBeInTheDocument();
    // It does not offer to issue a second authorisation for the same version.
    expect(screen.queryByRole("button", { name: /Issue authorisation/i })).toBeNull();
  });

  it("does not present one version's authorisation as another's", () => {
    mockSets([set([version({ id: "v5", versionNumber: 5, status: "approved" }), version()])]);
    mockIssue({ isSuccess: true, variables: "v4", data: { authorization: authorisation } });
    renderScope();

    expect(screen.queryByText(authorisation.signature)).toBeNull();
    expect(screen.getByRole("button", { name: /Issue authorisation/i })).toBeInTheDocument();
  });

  it("explains a 403 as a missing authorization.issue permission, not a generic failure", () => {
    mockSets([set([version()])]);
    mockIssue({ error: new ApiError("Your role does not allow this action. Ask an organisation owner if you need access.", 403) });
    renderScope();

    expect(screen.getByText("authorization.issue")).toBeInTheDocument();
    expect(screen.queryByText(/Your role does not allow/)).toBeNull();
  });

  it("surfaces a non-403 issue error near the action without breaking the screen", () => {
    mockSets([set([version()])]);
    mockIssue({ error: new ApiError("That conflicts with something that already exists.", 409) });
    renderScope();

    expect(screen.getByRole("alert")).toHaveTextContent(/conflicts/i);
    expect(screen.getByRole("button", { name: /Issue authorisation/i })).toBeInTheDocument();
  });
});
