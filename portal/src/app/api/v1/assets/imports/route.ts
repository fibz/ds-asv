import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { parseCsv, previewImport, applyImport } from "@/lib/assets/import";

export async function POST(request: NextRequest) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "asset.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  const body = await request.json().catch(() => null);
  const csvText = typeof body?.csv === "string" ? body.csv : "";
  const dryRun = body?.dryRun === true;
  if (!csvText) return NextResponse.json({ error: "csv is required" }, { status: 400 });
  try {
    const rows = parseCsv(csvText);
    if (dryRun) {
      const preview = await previewImport(ctx, rows);
      return NextResponse.json({ preview });
    }
    if (!idempotencyKey) return NextResponse.json({ error: "Idempotency-Key header is required" }, { status: 400 });
    const result = await applyImport(ctx, rows, idempotencyKey);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
