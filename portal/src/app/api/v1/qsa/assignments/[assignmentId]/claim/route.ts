import { NextRequest, NextResponse } from "next/server";
import { claimQsaAssignment } from "@/lib/qsa/assignment";
import { qsaAuth } from "@/lib/qsa/http";
import { routeErrorResponse } from "@/lib/http-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ assignmentId: string }> }) {
  const auth = await qsaAuth(request);
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ assignment: await claimQsaAssignment(auth.ctx, (await params).assignmentId) });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
