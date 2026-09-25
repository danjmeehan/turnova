import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAllTelemetry, upsertTelemetry } from "@/lib/telemetry";

export const runtime = "nodejs";

const upsertSchema = z.object({
  date: z.string().min(8),
  overnight_hrv: z.number().nullable().optional(),
  sleep_score: z.number().nullable().optional(),
  sleep_hours: z.number().nullable().optional(),
  resting_hr: z.number().nullable().optional(),
  stress: z.number().nullable().optional(),
  source: z.string().optional(),
  weekly_mileage: z.number().nullable().optional(),
  last_run_summary: z
    .object({
      distance: z.number().nullable().optional(),
      pace: z.string().nullable().optional(),
      cardiac_drift_pct: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export async function GET() {
  const telemetry = await getAllTelemetry();
  return NextResponse.json({ telemetry, count: telemetry.length });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const row = await upsertTelemetry(parsed.data);
  return NextResponse.json({ telemetry: row });
}
