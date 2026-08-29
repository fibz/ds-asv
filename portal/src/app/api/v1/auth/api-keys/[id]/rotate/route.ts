import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { generateApiKey, hashApiKey } from "@/lib/auth/api-keys";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
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