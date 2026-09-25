import { NextResponse } from "next/server";
import { deleteGarminToken, getGarminStatus } from "@/lib/garmin/tokens";

export const runtime = "nodejs";

export async function GET() {
  const status = await getGarminStatus();
  return NextResponse.json(status);
}

export async function DELETE() {
  await deleteGarminToken();
  return NextResponse.json({ connected: false });
}
