import { describe, it, expect } from "vitest";
import {
  authorizeUrl,
  clearSessionCookieHeader,
  hashSessionToken,
  parseCookies,
  sessionCookieHeader,
  sessionTokenFromRequest,
} from "@/lib/auth/session-cookie";

function fakeRequest(headers: Record<string, string | null>) {
  return {
    headers: { get: (name: string) => (name.toLowerCase() in headers ? headers[name.toLowerCase()] : null) },
  };
}

describe("session cookie helpers", () => {
  it("parses a raw Cookie header", () => {
    expect(parseCookies("a=1; b=two; asv_session=abc")).toEqual({ a: "1", b: "two", asv_session: "abc" });
    expect(parseCookies(null)).toEqual({});
  });

  it("sessionTokenFromRequest prefers Authorization Bearer over cookie", () => {
    const r = fakeRequest({ authorization: "Bearer headertok", cookie: "asv_session=cookietok" });
    expect(sessionTokenFromRequest(r)).toBe("headertok");
  });

  it("sessionTokenFromRequest falls back to the session cookie", () => {
    const r = fakeRequest({ cookie: "other=1; asv_session=cookietok" });
    expect(sessionTokenFromRequest(r)).toBe("cookietok");
  });

  it("sessionTokenFromRequest returns null with no token", () => {
    expect(sessionTokenFromRequest(fakeRequest({}))).toBeNull();
    expect(sessionTokenFromRequest(fakeRequest({ cookie: "a=1" }))).toBeNull();
  });

  it("hashSessionToken is sha256 of the raw token", () => {
    expect(hashSessionToken("tok")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken("tok")).toBe(hashSessionToken("tok"));
  });

  it("authorizeUrl points at the realm authorize endpoint with the code params", () => {
    const url = new URL(authorizeUrl("st-123", { clientId: "asv-portal", redirectUri: "http://localhost:3000/api/auth/callback" }));
    expect(url.pathname).toBe("/realms/asv-portal/protocol/openid-connect/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("asv-portal");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback");
    expect(url.searchParams.get("state")).toBe("st-123");
    expect(url.searchParams.get("scope")).toContain("openid");
  });

  it("session cookie header is httpOnly + lax and clear header nukes it", () => {
    const set = sessionCookieHeader("abc");
    expect(set).toContain("asv_session=abc");
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=lax");
    expect(clearSessionCookieHeader()).toContain("asv_session=");
    expect(clearSessionCookieHeader()).toContain("Max-Age=0");
  });
});
