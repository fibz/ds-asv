import { NextRequest, NextResponse } from "next/server";
import { tenantContextFromRequest } from "@/lib/tenant";
import { can } from "@/lib/auth/rbac";
import { ingestFindings, listFindings } from "@/lib/scan/findings";
import { verifyScanManifest } from "@/lib/scan/manifest";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const auth = request.headers.get("authorization") ?? "";
  const manifestMatch = /^Bearer\s+(.+)$/i.exec(auth);
  let orgId: string | null = null;
  if (manifestMatch) {
    // A Bearer token may be either a scanner manifest OR a real user's
    // Keycloak JWT (tenantContextFromRequest reads the same header). Try the
    // manifest first (scanner path is primary): if it verifies for THIS scan,
    // bind orgId from the manifest; if it verifies for a DIFFERENT scan, reject
    // (manifest for the wrong scan). If it does not verify, it is a user JWT —
    // fall through to the user-context path rather than 401ing.
    const verified = await verifyScanManifest(manifestMatch[1]);
    if (verified && verified.scanId === scanId) orgId = verified.organizationId;
    else if (verified) return NextResponse.json({ error: "Invalid or expired manifest" }, { status: 401 });
  }
  const ctx = await tenantContextFromRequest(request);
  if (!orgId) {
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!can(ctx, "scan.run")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    orgId = ctx.organizationId;
  } else if (ctx && ctx.organizationId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.findings)) {
    return NextResponse.json({ error: "findings array is required" }, { status: 400 });
  }
  const scannerCtx = ctx ?? { userId: "scanner", organizationId: orgId, role: "scan_operator", isStaff: false, appMode: "dev" };
  try {
    const { count } = await ingestFindings(scannerCtx, scanId, body.findings);
    return NextResponse.json({ count }, { status: 201 });
  } catch (err) {
    return routeErrorResponse(err, { notFound: "Scan not found" });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const ctx = await tenantContextFromRequest(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx, "scan.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { scanId } = await params;
  const findings = await listFindings(ctx, scanId);
  return NextResponse.json({ findings });
}
