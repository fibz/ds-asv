import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma-client";
import { GET as loginGET } from "./login/route";
import { GET as callbackGET } from "./callback/route";

vi.mock("jose", () => ({ jwtVerify: vi.fn(), createRemoteJWKSet: vi.fn(() => ({ mock: "jwks" })) }));

vi.mock("@/lib/prisma-client", () => {
  const txMock = {
    user: { create: vi.fn(), findUnique: vi.fn() },
    session: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    auditEvent: { create: vi.fn() },
    $executeRawUnsafe: vi.fn(),
  };
  return { prisma: { ...txMock, $transaction: vi.fn((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)) } };
});

const ISSUER = "http://127.0.0.1:8080/realms/asv-portal";
const CLAIMS = { sub: "kc-oauth-1", email: "ui@x.com", realm_access: { roles: [] } };

function req(path: string, cookies = ""): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookies ? { Cookie: cookies } : {},
  });
}

describe("auth login route", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", ISSUER);
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
    vi.stubEnv("KEYCLOAK_CLIENT_SECRET", "dev-secret");
    vi.stubEnv("APP_MODE", "dev");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("GET redirects to the realm authorize endpoint and sets the state cookie", async () => {
    const res = await loginGET(req("/api/auth/login"));
    expect(res.status).toBe(307); // NextResponse.redirect
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/realms/asv-portal/protocol/openid-connect/auth");
    expect(loc).toContain("response_type=code");
    expect(loc).toContain(`redirect_uri=${encodeURIComponent("http://localhost/api/auth/callback")}`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("asv_oauth_state=");
    expect(setCookie).toContain("HttpOnly");
  });

  it("GET 503 without an issuer", async () => {
    vi.stubEnv("KEYCLOAK_ISSUER", "");
    const res = await loginGET(req("/api/auth/login"));
    expect(res.status).toBe(503);
  });
});

describe("auth callback route", () => {
  beforeEach(() => {
    vi.stubEnv("KEYCLOAK_ISSUER", ISSUER);
    vi.stubEnv("KEYCLOAK_CLIENT_ID", "asv-portal");
    vi.stubEnv("KEYCLOAK_CLIENT_SECRET", "dev-secret");
    vi.stubEnv("APP_MODE", "dev");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("GET 400 without an authorization code", async () => {
    const res = await callbackGET(req("/api/auth/callback"));
    expect(res.status).toBe(400);
  });

  it("GET 400 when the OAuth state does not match the cookie", async () => {
    const res = await callbackGET(req("/api/auth/callback?code=c1&state=evil", "asv_oauth_state=good"));
    expect(res.status).toBe(400);
  });

  it("exchanges the code, provisions the user, and sets the session cookie", async () => {
    vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: CLAIMS, protectedHeader: {} } as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u1", idpId: CLAIMS.sub, email: CLAIMS.email } as never);
    vi.mocked(prisma.session.findFirst).mockResolvedValue(null as never);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at-1", id_token: "id-1", expires_in: 300 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await callbackGET(req("/api/auth/callback?code=secret-code&state=st", "asv_oauth_state=st"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // grant_type=authorization_code + confidential client secret
    const body = fetchMock.mock.calls[0][1]?.body?.toString() ?? "";
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=secret-code");
    expect(body).toContain("client_secret=dev-secret");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/dashboard");
    const setCookies = res.headers.get("set-cookie") ?? "";
    expect(setCookies).toContain("asv_session=at-1");
    expect(setCookies).toContain("HttpOnly");
    // The access token was verified through the portal's real verify path
    // before the cookie was set.
    expect(jwtVerify).toHaveBeenCalledTimes(1);
  });

  it("GET 502 when the token exchange fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401, headers: { "Content-Type": "application/json" } })
    ));
    const res = await callbackGET(req("/api/auth/callback?code=bad&state=st", "asv_oauth_state=st"));
    expect(res.status).toBe(502);
  });
});
