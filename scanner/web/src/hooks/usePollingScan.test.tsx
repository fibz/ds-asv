import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { ReactNode } from "react";
import type { ScanStatusPayload } from "../api/types";
import { isTerminal, pollIntervalFor, usePollingScan } from "./usePollingScan";

vi.mock("../api/scans", () => ({
  getScan: vi.fn(),
}));

import { getScan } from "../api/scans";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

describe("pollIntervalFor", () => {
  it("keeps polling (2500ms) while the scan is not terminal", () => {
    expect(pollIntervalFor("pending")).toBe(2500);
    expect(pollIntervalFor("enqueued")).toBe(2500);
    expect(pollIntervalFor("running")).toBe(2500);
  });
  it("stops polling on terminal statuses", () => {
    expect(pollIntervalFor("completed")).toBe(false);
    expect(pollIntervalFor("failed")).toBe(false);
    expect(pollIntervalFor("partial")).toBe(false);
    expect(pollIntervalFor(undefined)).toBe(2500);
  });
});

describe("isTerminal", () => {
  it("flags only completed/failed/partial", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("partial")).toBe(true);
    expect(isTerminal("running")).toBe(false);
  });
});

describe("usePollingScan", () => {
  it("fetches the scan status", async () => {
    const payload: ScanStatusPayload = {
      scan_id: "s1",
      status: "running",
      scan_type: "quarterly",
    };
    (getScan as Mock).mockResolvedValue(payload);
    const client = makeClient();
    const { result } = renderHook(() => usePollingScan("s1"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.data?.status).toBe("running"));
    expect(getScan).toHaveBeenCalledWith("s1");
  });

  it("is disabled without a scan id", () => {
    const client = makeClient();
    const { result } = renderHook(() => usePollingScan(undefined), {
      wrapper: wrapper(client),
    });
    expect(result.current.isPending || result.current.isLoading).toBe(true);
    expect(result.current.fetchStatus).toBe("idle");
  });
});
