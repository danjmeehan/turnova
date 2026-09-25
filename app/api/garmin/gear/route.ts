import { NextResponse } from "next/server";
import { listGarminGear } from "@/lib/garmin/gear";
import { getGarminStatus } from "@/lib/garmin/tokens";

export const runtime = "nodejs";

export async function GET() {
  const status = await getGarminStatus();
  const gear = status.connected ? await listGarminGear() : [];
  return NextResponse.json({
    connected: status.connected,
    lastSyncedAt: status.lastSyncedAt,
    gear,
  });
}
