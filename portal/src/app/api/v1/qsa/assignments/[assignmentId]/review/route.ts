import { NextRequest, NextResponse } from "next/server";
import { getQsaReview } from "@/lib/qsa/review";
import { qsaAuth } from "@/lib/qsa/http";
import { routeErrorResponse } from "@/lib/http-error";

export async function GET(request: NextRequest, { params }: { params: Promise<{ assignmentId: string }> }) {
  const auth = await qsaAuth(request);
  if ("response" in auth) return auth.response;
  try {
    const review = await getQsaReview(auth.ctx, (await params).assignmentId);
    if (!review) return NextResponse.json({ error: "QSA review not found" }, { status: 404 });
    return NextResponse.json({ review });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
