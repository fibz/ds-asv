import { NextRequest, NextResponse } from "next/server";
import { provisionUserFromToken } from "@/lib/auth/keycloak";
import { sessionCookieHeader } from "@/lib/auth/session-cookie";
import { getAppMode, setRlsContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma-client";

const DEMO_ACCOUNTS = {
  customer: { username: "regular-user", password: "user123", destination: "/customer" },
  qsa: { username: "staff-user", password: "staff123", destination: "/qsa" },
} as const;

async function ensureDevMembership(idpId: string, role: keyof typeof DEMO_ACCOUNTS) {
  await prisma.$transaction(async (tx) => {
    const qsaOrganizationId = "demo_qsa";
    const customerOrganizationId = "demo_customer";
    await setRlsContext(qsaOrganizationId, tx);
    if (!(await tx.organization.findUnique({ where: { id: qsaOrganizationId } }))) {
      await tx.organization.create({ data: { id: qsaOrganizationId, name: "Demo QSA" } });
    }
    if (!(await tx.organization.findUnique({ where: { id: customerOrganizationId } }))) {
      await tx.organization.create({ data: { id: customerOrganizationId, name: "Demo Customer", parentOrgId: qsaOrganizationId } });
    }
    const user = await tx.user.findUnique({ where: { idpId } });
    if (!user) throw new Error("development login user was not provisioned");
    const organizationId = role === "qsa" ? qsaOrganizationId : customerOrganizationId;
    await setRlsContext(organizationId, tx);
    await tx.organizationMembership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId } },
      create: { userId: user.id, organizationId, role: role === "qsa" ? "report_viewer" : "organization_owner", status: "active" },
      update: { role: role === "qsa" ? "report_viewer" : "organization_owner", status: "active" },
    });
  });
}

/**
 * Development convenience only. This deliberately uses the local Keycloak
 * password grant and is unavailable when APP_MODE=prod; production keeps the
 * authorization-code flow at /api/auth/login.
 */
export async function GET(request: NextRequest) {
  if (getAppMode() === "prod") return NextResponse.json({ error: "not found" }, { status: 404 });
  const role = request.nextUrl.searchParams.get("role") as keyof typeof DEMO_ACCOUNTS | null;
  const account = role ? DEMO_ACCOUNTS[role] : undefined;
  if (!account || !role) return NextResponse.json({ error: "role must be customer or qsa" }, { status: 400 });

  const issuer = process.env.KEYCLOAK_ISSUER?.replace(/\/+$/, "");
  const clientId = process.env.KEYCLOAK_CLIENT_ID;
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) {
    return NextResponse.json({ error: "local Keycloak configuration is incomplete" }, { status: 503 });
  }

  try {
    const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: clientId,
        client_secret: clientSecret,
        username: account.username,
        password: account.password,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (!response.ok || !data.access_token) {
      console.error("development login failed:", data.error ?? response.statusText);
      return NextResponse.json({ error: "development login failed" }, { status: 502 });
    }
    const user = await provisionUserFromToken(data.access_token);
    await ensureDevMembership(user.idpId, role);
    // Keep the redirect relative so a session started on 127.0.0.1 is not
    // silently switched to localhost (cookies are host-scoped in browsers).
    const result = new NextResponse(null, { status: 303, headers: { location: account.destination } });
    result.headers.append("set-cookie", sessionCookieHeader(data.access_token));
    return result;
  } catch (error) {
    console.error("development login unavailable:", error);
    return NextResponse.json({ error: "development login unavailable" }, { status: 502 });
  }
}
