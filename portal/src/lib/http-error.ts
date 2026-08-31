import { NextResponse } from "next/server";
import { TeamGuardError } from "@/lib/org/team";

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
  if (opts.notFound && err instanceof Error && err.message === opts.notFound) {
    return NextResponse.json({ error: opts.notFound }, { status: 404 });
  }
  console.error("route error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
