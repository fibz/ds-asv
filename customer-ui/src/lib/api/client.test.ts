import { describe, it, expect, vi, afterEach } from "vitest";
import { apiGet, apiPost, ApiError } from "./client";

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

describe("apiPost", () => {
  it("posts to the prefixed URL and always sends the session cookie", async () => {
    const fetchMock = stubFetch({ json: async () => ({ version: { id: "v1" } }) });
    await apiPost("/scope-versions/v1/submit");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/scope-versions/v1/submit",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
  });

  it("returns the parsed body", async () => {
    stubFetch({ json: async () => ({ version: { id: "v1", status: "submitted" } }) });
    await expect(apiPost("/scope-versions/v1/submit")).resolves.toEqual({
      version: { id: "v1", status: "submitted" },
    });
  });

  it("sends a JSON body when one is given", async () => {
    const fetchMock = stubFetch({ json: async () => ({ scopeSet: { id: "set1" } }) });
    await apiPost("/scope-sets", { name: "Production" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ name: "Production" }));
  });

  it("omits the body when none is given, so submit does not post a phantom payload", async () => {
    const fetchMock = stubFetch({ json: async () => ({ version: { id: "v1" } }) });
    await apiPost("/scope-versions/v1/submit");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
  });

  it("throws ApiError with the status on 403 so a permission problem is routable", async () => {
    stubFetch({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });
    const err = (await apiPost("/scope-versions/v1/submit").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
  });

  it("never leaks raw server text as the message", async () => {
    stubFetch({ ok: false, status: 403, json: async () => ({ error: "ScopeGuardError: forbidden by scope.manage" }) });
    const err = (await apiPost("/scope-versions/v1/submit").catch((e: unknown) => e)) as ApiError;
    expect(err.message).not.toContain("ScopeGuardError");
    expect(err.status).toBe(403);
  });
});

