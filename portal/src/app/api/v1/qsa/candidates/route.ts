import { NextRequest, NextResponse } from "next/server";
import { listQsaCandidateReports } from "@/lib/qsa/assignment";
import { qsaAuth } from "@/lib/qsa/http";
import { routeErrorResponse } from "@/lib/http-error";

export async function GET(request: NextRequest) {
  const auth = await qsaAuth(request);
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ candidates: await listQsaCandidateReports(auth.ctx) });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
