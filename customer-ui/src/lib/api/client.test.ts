import { describe, it, expect, vi, afterEach } from "vitest";
import { apiGet, ApiError } from "./client";

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({}), ...response,
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("apiGet", () => {
  it("prefixes /api/v1 and always sends the session cookie", async () => {
    const fetchMock = stubFetch({ json: async () => ({ assets: [] }) });
    await apiGet("/assets");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/assets",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("returns the parsed body", async () => {
    stubFetch({ json: async () => ({ assets: [{ id: "a1" }] }) });
    await expect(apiGet("/assets")).resolves.toEqual({ assets: [{ id: "a1" }] });
  });

  it("throws ApiError with the status for 401 so the caller can route to sign-in", async () => {
    stubFetch({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) });
    // The status is what routes to sign-in; the message is the safe 401 copy,
    // never the server's raw text (which the next test pins down).
    await expect(apiGet("/assets")).rejects.toMatchObject(
      new ApiError("Your session has expired. Sign in again to continue.", 401)
    );
  });

  it("never leaks raw server text as the message", async () => {
    stubFetch({ ok: false, status: 500, json: async () => ({ error: "prisma.asset.findMany() failed" }) });
    const err = (await apiGet("/assets").catch((e: unknown) => e)) as ApiError;
    expect(err.message).not.toContain("prisma");
    expect(err.status).toBe(500);
  });
});
