import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, apiPost: vi.fn() };
});

import { useRaiseDispute, useIssueAuthorization, useSubmitScopeVersion, keys } from "./queries";
import { apiPost } from "./client";

afterEach(() => { vi.clearAllMocks(); });

const wrapperFor = (queryClient: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

describe("useSubmitScopeVersion", () => {
  it("POSTs the submit route for the given version, with no request body", async () => {
    vi.mocked(apiPost).mockResolvedValue({ version: { id: "v5", status: "submitted" } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSubmitScopeVersion(), { wrapper: wrapperFor(queryClient) });

    result.current.mutate("v5");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The route contract: POST /scope-versions/{id}/submit, and it reads no body.
    expect(apiPost).toHaveBeenCalledWith("/scope-versions/v5/submit");
  });

  it("invalidates the scope-sets key on success so the draft refetches as submitted", async () => {
    vi.mocked(apiPost).mockResolvedValue({ version: { id: "v5", status: "submitted" } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSubmitScopeVersion(), { wrapper: wrapperFor(queryClient) });

    result.current.mutate("v5");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.scopeSets });
  });
});

describe("useRaiseDispute", () => {
  it("POSTs the finding's dispute route with the justification field the route reads", async () => {
    vi.mocked(apiPost).mockResolvedValue({ dispute: { id: "d1" } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRaiseDispute("s1"), { wrapper: wrapperFor(queryClient) });

    result.current.mutate({ findingId: "f1", justification: "Not reachable from the internet" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Route contract: POST /findings/{findingId}/disputes, body reads only `justification`.
    expect(apiPost).toHaveBeenCalledWith("/findings/f1/disputes", { justification: "Not reachable from the internet" });
  });

  it("invalidates the findings key for that scan so the new dispute appears", async () => {
    vi.mocked(apiPost).mockResolvedValue({ dispute: { id: "d1" } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRaiseDispute("s1"), { wrapper: wrapperFor(queryClient) });

    result.current.mutate({ findingId: "f1", justification: "x" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.findings("s1") });
  });
});

describe("useIssueAuthorization", () => {
  it("POSTs the authorisation route for the version, reading no request body", async () => {
    vi.mocked(apiPost).mockResolvedValue({ authorization: { id: "auth1" } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useIssueAuthorization(), { wrapper: wrapperFor(queryClient) });

    result.current.mutate("v4");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith("/scope-versions/v4/authorization");
  });

  it("invalidates the scope-set read on success (the route upserts the authorisation row)", async () => {
    vi.mocked(apiPost).mockResolvedValue({ authorization: { id: "auth1" } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useIssueAuthorization(), { wrapper: wrapperFor(queryClient) });

    result.current.mutate("v4");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.scopeSets });
  });
});
