import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeUrl,
  clearSessionCookieHeader,
  exchangeCode,
  hashSessionToken,
  parseCookies,
  publicOrigin,
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

// These two blocks exist because production broke without them: behind the
// reverse proxy Next derived an INTERNAL origin, so the realm rejected the
// redirect_uri and Node was asked to trust the proxy's self-signed cert.
describe("publicOrigin (the reverse-proxy origin)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers PUBLIC_ORIGIN over the origin Next derives from the request", () => {
    vi.stubEnv("PUBLIC_ORIGIN", "https://74.156.0.13:8443");
    expect(publicOrigin("https://0.0.0.0:3000")).toBe("https://74.156.0.13:8443");
  });

  it("strips trailing slashes so the redirect_uri cannot double up", () => {
    vi.stubEnv("PUBLIC_ORIGIN", "https://example.test/");
    expect(publicOrigin("https://0.0.0.0:3000")).toBe("https://example.test");
  });

  it("falls back to the request origin in dev (unset or empty)", () => {
    vi.stubEnv("PUBLIC_ORIGIN", "");
    expect(publicOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    vi.unstubAllEnvs();
    delete process.env.PUBLIC_ORIGIN;
    expect(publicOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });
});

describe("exchangeCode talks to the internal issuer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts the code exchange to KEYCLOAK_INTERNAL_ISSUER, not the public URL", async () => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://74.156.0.13:8443/auth/realms/asv-portal");
    vi.stubEnv("KEYCLOAK_INTERNAL_ISSUER", "http://keycloak:8080/auth/realms/asv-portal");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
    vi.stubEnv("KEYCLOAK_CLIENT_SECRET", "dev-secret");
    const fetchMock = stubFetch();

    await exchangeCode("code-1", "https://74.156.0.13:8443/api/auth/callback");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://keycloak:8080/auth/realms/asv-portal/protocol/openid-connect/token"
    );
  });

  it("falls back to the public issuer when no internal one is configured", async () => {
    vi.stubEnv("KEYCLOAK_ISSUER", "https://74.156.0.13:8443/auth/realms/asv-portal");
    vi.stubEnv("KEYCLOAK_INTERNAL_ISSUER", "");
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
    vi.stubEnv("KEYCLOAK_CLIENT_SECRET", "dev-secret");
    const fetchMock = stubFetch();

    await exchangeCode("code-2", "https://74.156.0.13:8443/api/auth/callback");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://74.156.0.13:8443/auth/realms/asv-portal/protocol/openid-connect/token"
    );
  });
});
