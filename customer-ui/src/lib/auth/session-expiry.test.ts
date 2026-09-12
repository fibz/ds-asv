import { describe, it, expect } from "vitest";
import { ApiError } from "../api/client";
import { SESSION_EXPIRED_PATH, sessionExpiryRedirect } from "./session-expiry";

describe("sessionExpiryRedirect", () => {
  it("sends a 401 to the sign-in landing with the expired reason, for base /app/", () => {
    expect(sessionExpiryRedirect(new ApiError("Unauthorized", 401), "/app/")).toBe(
      "/app/sign-in?reason=expired"
    );
  });

  it("leaves a 403 on the screen it happened on - a permission wall is not a session expiry", () => {
    expect(sessionExpiryRedirect(new ApiError("Forbidden", 403), "/app/")).toBeNull();
  });

  it("does not redirect for other statuses or a plain Error", () => {
    expect(sessionExpiryRedirect(new ApiError("Not found", 404), "/app/")).toBeNull();
    expect(sessionExpiryRedirect(new ApiError("Server", 500), "/app/")).toBeNull();
    expect(sessionExpiryRedirect(new Error("boom"), "/app/")).toBeNull();
    expect(sessionExpiryRedirect(undefined, "/app/")).toBeNull();
    expect(sessionExpiryRedirect("401", "/app/")).toBeNull();
  });

  it("builds the URL from the base it is handed, never a hardcoded /app", () => {
    expect(sessionExpiryRedirect(new ApiError("Unauthorized", 401), "http://x/")).toBe(
      "http://x/sign-in?reason=expired"
    );
    expect(sessionExpiryRedirect(new ApiError("Unauthorized", 401), "/")).toBe(
      "/sign-in?reason=expired"
    );
  });

  it("exposes the path it appends so sign-in and the redirect agree on one constant", () => {
    expect(SESSION_EXPIRED_PATH).toBe("sign-in?reason=expired");
  });
});
