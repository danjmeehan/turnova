import { NextResponse } from "next/server";
import { loadAthleteProfile } from "@/lib/athlete-profile";
import { searchRunsignupRaces, zipFromLocation } from "@/lib/runsignup";

export const runtime = "nodejs";

function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw?.trim()) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const name = url.searchParams.get("q")?.trim() || undefined;
    const profile = loadAthleteProfile();
    const zip = zipFromLocation(profile.location);
    const saved = profile.race_search;
    const typesParam = url.searchParams.get("types");
    const races = await searchRunsignupRaces({
      zip,
      name,
      radius: parsePositiveInt(url.searchParams.get("radius")) ?? saved.radius_miles,
      windowMonths:
        parsePositiveInt(url.searchParams.get("months")) ?? saved.window_months,
      eventTypes:
        typesParam !== null
          ? typesParam.split(",").map((type) => type.trim()).filter(Boolean)
          : saved.event_types,
    });
    return NextResponse.json({ zip, races });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Race search failed";
    console.error("[api/races/search]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
