import { NextResponse } from "next/server";
import { getStoredGarminTokens } from "@/lib/garmin/tokens";
import { syncRecentGarmin } from "@/lib/garmin/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const token = await getStoredGarminTokens();
  if (!token) {
    return NextResponse.json(
      { error: "Garmin not connected. Use Connect Garmin first." },
      { status: 401 },
    );
  }

  const result = await syncRecentGarmin(14);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Garmin sync failed", ...result },
      { status: 502 },
    );
  }
  return NextResponse.json(result);
}
