import { NextResponse } from "next/server";
import { tenantContextFromRequest, type TenantContext } from "@/lib/tenant";

export async function qsaAuth(request: { headers: { get(name: string): string | null } }): Promise<{ ctx: TenantContext } | { response: NextResponse }> {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!ctx.isStaff) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ctx };
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
