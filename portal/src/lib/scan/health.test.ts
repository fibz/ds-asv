import { afterEach, describe, expect, it, vi } from "vitest";
import { getScannerHealth } from "./health";

describe("getScannerHealth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns only the observed scanner identity when its health response is valid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", service: "asv-scanner-api", version: "1.0.0" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getScannerHealth()).resolves.toEqual({
      available: true,
      service: "asv-scanner-api",
      version: "1.0.0",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/health",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("does not claim availability for an invalid or unreachable scanner response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));
    await expect(getScannerHealth()).resolves.toEqual({
      available: false,
      error: "Scanner returned an invalid health response",
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    await expect(getScannerHealth()).resolves.toEqual({ available: false, error: "Scanner is unreachable" });
  });
});
