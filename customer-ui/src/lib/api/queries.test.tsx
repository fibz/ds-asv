import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, apiPost: vi.fn() };
});

import { useSubmitScopeVersion, keys } from "./queries";
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
