import { NextRequest, NextResponse } from "next/server";
import { attestAssignedReport } from "@/lib/qsa/review";
import { badRequest, isRecord, qsaAuth } from "@/lib/qsa/http";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ assignmentId: string }> }) {
  const auth = await qsaAuth(request);
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => ({}));
  if (!isRecord(body) || (body.reason !== undefined && typeof body.reason !== "string")) return badRequest("reason must be a string");
  if (typeof body.reason === "string" && body.reason.length > 2000) return badRequest("reason must be 2000 characters or fewer");
  try {
    const review = await attestAssignedReport(auth.ctx, (await params).assignmentId, typeof body.reason === "string" ? body.reason : undefined);
    if (!review) return NextResponse.json({ error: "QSA review not found" }, { status: 404 });
    return NextResponse.json({ review });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
