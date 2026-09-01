import { NextResponse } from "next/server";
import { TeamGuardError } from "@/lib/org/team";
import { ScanGuardError } from "@/lib/scan/service";
import { ReportGuardError } from "@/lib/scan/report";
import { ScopeGuardError } from "@/lib/scope/service";
import { DisputeGuardError } from "@/lib/disputes/service";

/**
 * Maps an unexpected route/service error to a response following the
 * api-keys convention: typed guard errors → 409, a genuine not-found
 * (exact message match) → 404, everything else → logged + 500. Never
 * echoes raw error messages to clients.
 */
export function routeErrorResponse(
  err: unknown,
  opts: { notFound?: string } = {}
): NextResponse {
  if (err instanceof TeamGuardError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof ScanGuardError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof ReportGuardError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof ScopeGuardError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof DisputeGuardError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (opts.notFound && err instanceof Error && err.message === opts.notFound) {
    return NextResponse.json({ error: opts.notFound }, { status: 404 });
  }
  console.error("route error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
