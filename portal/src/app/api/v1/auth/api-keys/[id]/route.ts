import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma-client";
import { maskApiKey } from "@/lib/auth/api-keys";
import { provisionKeycloakUser } from "@/lib/auth/keycloak";

function serialize(key: {
  id: string;
  name: string;
  keyHash: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: key.id,
    name: key.name,
    maskedKey: maskApiKey(key.keyHash),
    scopes: key.scopes,
    lastUsedAt: key.lastUsedAt?.toISOString() || null,
    expiresAt: key.expiresAt?.toISOString() || null,
    revokedAt: key.revokedAt?.toISOString() || null,
    createdAt: key.createdAt.toISOString(),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const keycloakUser = await provisionKeycloakUser(request);
  if (!keycloakUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { idpId: keycloakUser.idpId },
  });
  if (!user || !user.orgId || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const key = await prisma.apiKey.findFirst({
    where: { id, orgId: user.orgId },
  });

  if (!key) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(serialize(key));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const keycloakUser = await provisionKeycloakUser(request);
  if (!keycloakUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { idpId: keycloakUser.idpId },
  });
  if (!user || !user.orgId || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { name, scopes } = body;

  const existing = await prisma.apiKey.findFirst({
    where: { id, orgId: user.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.apiKey.update({
    where: { id },
    data: {
      name: name ?? existing.name,
      scopes: scopes ?? existing.scopes,
    },
  });

  return NextResponse.json(serialize(updated));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const keycloakUser = await provisionKeycloakUser(request);
  if (!keycloakUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { idpId: keycloakUser.idpId },
  });
  if (!user || !user.orgId || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.apiKey.findFirst({
    where: { id, orgId: user.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });

  return new NextResponse(null, { status: 204 });
}