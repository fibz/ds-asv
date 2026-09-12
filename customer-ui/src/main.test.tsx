import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createQueryClient } from "./main";
import { ApiError } from "./lib/api/client";

// jsdom does not implement navigation. Replace window.location with a recorder
// and restore the real one afterwards, so the wiring is asserted against the
// client the app actually builds - not a copy of its config.
const replace = vi.fn();
const originalLocation = window.location;

beforeEach(() => {
  replace.mockReset();
  Object.defineProperty(window, "location", {
    value: { replace },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
  vi.unstubAllEnvs();
});

let probe = 0;
const failingQuery = (error: unknown) => ({
  queryKey: ["session-expiry-probe", probe++],
  queryFn: () => Promise.reject(error),
  retry: false as const,
});

describe("main query client wiring", () => {
  it("routes a query failure with 401 to the sign-in landing, built from BASE_URL", async () => {
    // Vitest does not apply vite.config's `base`, so pin the production value
    // here: the app's BASE_URL is `/app/` and the redirect must land on it.
    vi.stubEnv("BASE_URL", "/app/");
    const client = createQueryClient();
    await client
      .fetchQuery(failingQuery(new ApiError("Unauthorized", 401)))
      .catch(() => undefined);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/app/sign-in?reason=expired");
  });

  it("follows BASE_URL rather than a hardcoded /app prefix", async () => {
    vi.stubEnv("BASE_URL", "/elsewhere/");
    const client = createQueryClient();
    await client
      .fetchQuery(failingQuery(new ApiError("Unauthorized", 401)))
      .catch(() => undefined);

    expect(replace).toHaveBeenCalledWith("/elsewhere/sign-in?reason=expired");
  });

  it("leaves a non-401 (403) on the screen - the wiring must not redirect it", async () => {
    vi.stubEnv("BASE_URL", "/app/");
    const client = createQueryClient();
    await client
      .fetchQuery(failingQuery(new ApiError("Forbidden", 403)))
      .catch(() => undefined);

    expect(replace).not.toHaveBeenCalled();
  });
});
