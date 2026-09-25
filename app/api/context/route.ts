import { NextResponse } from "next/server";
import { getInjectedContextPreview } from "@/lib/context";
import { getAllTelemetry } from "@/lib/telemetry";

export const runtime = "nodejs";

export async function GET() {
  const telemetry = await getAllTelemetry();
  const preview = await getInjectedContextPreview(telemetry);
  return NextResponse.json(preview);
}
