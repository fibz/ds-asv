// customer-ui/src/lib/download.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { authorizationFilename, saveJsonFile } from "./download";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authorizationFilename", () => {
  it("names the file after the scope set and the approved version number", () => {
    expect(authorizationFilename("Production", 4)).toBe("authorisation-Production-v4.json");
  });

  it("turns spaces and punctuation into dashes so the name is filesystem-safe", () => {
    expect(authorizationFilename("Q3 External / EU", 2)).toBe("authorisation-Q3-External-EU-v2.json");
  });

  it("falls back to a generic stem rather than producing a nameless file", () => {
    expect(authorizationFilename("   ", 1)).toBe("authorisation-scope-v1.json");
  });
});

describe("saveJsonFile", () => {
  it("downloads the returned data as a JSON blob under the given name, then releases the URL", () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    let captured: { href: string; download: string } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      captured = { href: this.href, download: this.download };
    });

    saveJsonFile("authorisation-Production-v4.json", { signature: "abc" });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(captured).toEqual({ href: "blob:mock", download: "authorisation-Production-v4.json" });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });
});
