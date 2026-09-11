import { NextRequest, NextResponse } from "next/server";
import { createQsaAssignment, listQsaAssignments } from "@/lib/qsa/assignment";
import { badRequest, isRecord, qsaAuth } from "@/lib/qsa/http";
import { routeErrorResponse } from "@/lib/http-error";
import type { QsaAssignmentStatus } from "@/lib/qsa/types";

const statuses: QsaAssignmentStatus[] = ["queued", "assigned", "in_review", "completed", "cancelled"];

export async function GET(request: NextRequest) {
  const auth = await qsaAuth(request);
  if ("response" in auth) return auth.response;
  const value = request.nextUrl.searchParams.get("status");
  if (value && !statuses.includes(value as QsaAssignmentStatus)) return badRequest("invalid assignment status");
  try {
    return NextResponse.json({ assignments: await listQsaAssignments(auth.ctx, value ? { status: value as QsaAssignmentStatus } : {}) });
  } catch (err) {
    return routeErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const auth = await qsaAuth(request);
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.reportId !== "string") return badRequest("reportId is required");
  if (body.assigneeUserId !== undefined && body.assigneeUserId !== null && typeof body.assigneeUserId !== "string") return badRequest("assigneeUserId must be a string or null");
  if (body.notes !== undefined && typeof body.notes !== "string") return badRequest("notes must be a string");
  let dueAt: Date | undefined;
  if (body.dueAt !== undefined) {
    if (typeof body.dueAt !== "string") return badRequest("dueAt must be an ISO date string");
    dueAt = new Date(body.dueAt);
    if (Number.isNaN(dueAt.getTime())) return badRequest("dueAt must be an ISO date string");
  }
  try {
    const assignment = await createQsaAssignment(auth.ctx, {
      reportId: body.reportId,
      assigneeUserId: typeof body.assigneeUserId === "string" ? body.assigneeUserId : undefined,
      dueAt,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
