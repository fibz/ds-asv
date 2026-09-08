import { NextRequest, NextResponse } from "next/server";
import { moderateAssignedDispute } from "@/lib/qsa/review";
import { badRequest, isRecord, qsaAuth } from "@/lib/qsa/http";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ assignmentId: string; disputeId: string }> }) {
  const auth = await qsaAuth(request);
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => null);
  if (!isRecord(body) || !["resolved", "rejected"].includes(String(body.status))) return badRequest("status must be resolved or rejected");
  if (body.note !== undefined && typeof body.note !== "string") return badRequest("note must be a string");
  if (typeof body.note === "string" && body.note.length > 2000) return badRequest("note must be 2000 characters or fewer");
  const { assignmentId, disputeId } = await params;
  try {
    const review = await moderateAssignedDispute(auth.ctx, assignmentId, disputeId, { status: body.status as "resolved" | "rejected", note: typeof body.note === "string" ? body.note : undefined });
    if (!review) return NextResponse.json({ error: "dispute or QSA review not found" }, { status: 404 });
    return NextResponse.json({ review });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
