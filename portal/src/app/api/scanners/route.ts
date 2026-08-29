import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { target, type } = body;

  // TODO: Integrate with T3MP3ST scanner
  // const tempest = new T3MP3STClient(process.env.T3MP3ST_API_URL);
  // const scan = await tempest.startScan({ target, type });

  return NextResponse.json({
    scan: {
      id: "placeholder-scan-id",
      target,
      type,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
    },
  });
}

export async function GET(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: Fetch scans from database
  return NextResponse.json({ scans: [] });
}
