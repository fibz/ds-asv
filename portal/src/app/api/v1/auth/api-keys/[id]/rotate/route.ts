import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma-client";
import { generateApiKey, hashApiKey } from "@/lib/auth/api-keys";
import { provisionKeycloakUser } from "@/lib/auth/keycloak";

export async function POST(
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

  const rawKey = generateApiKey();
  const keyHash = await hashApiKey(rawKey);

  const updated = await prisma.apiKey.update({
    where: { id },
    data: { keyHash, revokedAt: null },
  });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    key: rawKey,
    scopes: updated.scopes,
    expiresAt: updated.expiresAt?.toISOString() || null,
  });
}