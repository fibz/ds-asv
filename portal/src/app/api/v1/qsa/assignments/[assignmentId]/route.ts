import { NextRequest, NextResponse } from "next/server";
import { cancelQsaAssignment, listQsaAssignments, reassignQsaAssignment } from "@/lib/qsa/assignment";
import { badRequest, isRecord, qsaAuth } from "@/lib/qsa/http";
import { routeErrorResponse } from "@/lib/http-error";

type Params = { params: Promise<{ assignmentId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await qsaAuth(request);
  if ("response" in auth) return auth.response;
  const { assignmentId } = await params;
  try {
    const assignment = (await listQsaAssignments(auth.ctx)).find((row) => row.id === assignmentId);
    if (!assignment) return NextResponse.json({ error: "QSA assignment not found" }, { status: 404 });
    return NextResponse.json({ assignment });
  } catch (err) {
    return routeErrorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await qsaAuth(request);
  if ("response" in auth) return auth.response;
  const { assignmentId } = await params;
  const body = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.action !== "string") return badRequest("action must be reassign or cancel");
  try {
    if (body.action === "reassign") {
      if (body.assigneeUserId !== null && typeof body.assigneeUserId !== "string") return badRequest("assigneeUserId must be a string or null");
      return NextResponse.json({ assignment: await reassignQsaAssignment(auth.ctx, assignmentId, body.assigneeUserId as string | null) });
    }
    if (body.action === "cancel") {
      if (typeof body.reason !== "string") return badRequest("reason is required");
      return NextResponse.json({ assignment: await cancelQsaAssignment(auth.ctx, assignmentId, body.reason) });
    }
    return badRequest("action must be reassign or cancel");
  } catch (err) {
    return routeErrorResponse(err);
  }
}
