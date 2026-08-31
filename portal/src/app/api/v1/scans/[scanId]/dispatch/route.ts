import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { dispatchScanToScanner } from "@/lib/scan/dispatch";

export async function POST(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scan.run")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { scanId } = await params;
  try {
    const result = await dispatchScanToScanner(ctx, scanId);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Dispatch failed" }, { status: 500 });
  }
}
