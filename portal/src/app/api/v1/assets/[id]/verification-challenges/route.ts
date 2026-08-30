import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { createVerificationChallenge } from "@/lib/assets/verification";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "asset.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const method = body?.method === "dns_txt" ? "dns_txt" : body?.method === "manual" ? "manual" : null;
  if (!method) return NextResponse.json({ error: "method must be dns_txt or manual" }, { status: 400 });
  try {
    const challenge = await createVerificationChallenge(ctx, id, method);
    return NextResponse.json(challenge, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === "Asset not found" ? 404 : 400 });
  }
}
