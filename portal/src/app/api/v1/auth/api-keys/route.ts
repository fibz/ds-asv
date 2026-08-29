import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma-client";
import { hashApiKey, generateApiKey, maskApiKey } from "@/lib/auth/api-keys";
import { getKeycloakUser } from "@/lib/auth/keycloak";

export async function POST(request: NextRequest) {
  const keycloakUser = await getKeycloakUser(request);

  if (!keycloakUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { idpId: keycloakUser.idpId },
  });
  if (!user || !user.orgId) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  if (user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { name, scopes, expiresAt } = body;

  if (!name || !scopes || !Array.isArray(scopes) || scopes.length === 0) {
    return NextResponse.json(
      { error: "Name and scopes are required" },
      { status: 400 }
    );
  }

  const rawKey = generateApiKey();
  const keyHash = await hashApiKey(rawKey);

  const apiKey = await prisma.apiKey.create({
    data: {
      name,
      keyHash,
      scopes,
      orgId: user.orgId,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  });

  return NextResponse.json(
    {
      id: apiKey.id,
      name: apiKey.name,
      key: rawKey,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt?.toISOString() || null,
    },
    { status: 201 }
  );
}

export async function GET(request: NextRequest) {
  const keycloakUser = await getKeycloakUser(request);

  if (!keycloakUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { idpId: keycloakUser.idpId },
  });
  if (!user || !user.orgId) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  if (user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const keys = await prisma.apiKey.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    keys.map((k: { id: string; name: string; keyHash: string; scopes: string[]; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date }) => ({
      id: k.id,
      name: k.name,
      maskedKey: maskApiKey(k.keyHash),
      scopes: k.scopes,
      lastUsedAt: k.lastUsedAt?.toISOString() || null,
      expiresAt: k.expiresAt?.toISOString() || null,
      revokedAt: k.revokedAt?.toISOString() || null,
      createdAt: k.createdAt.toISOString(),
    }))
  );
}