import { NextResponse } from "next/server";
import {
  loadAthleteProfile,
  saveAthleteProfile,
} from "@/lib/athlete-profile";

export const runtime = "nodejs";

export async function GET() {
  try {
    const profile = loadAthleteProfile();
    return NextResponse.json({ profile });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load athlete profile";
    console.error("[api/profile] GET", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { profile?: unknown };
    if (body.profile === undefined) {
      return NextResponse.json(
        { error: "Body must include { profile: … }" },
        { status: 400 },
      );
    }
    const profile = saveAthleteProfile(body.profile);
    return NextResponse.json({ profile });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save athlete profile";
    console.error("[api/profile] PUT", err);
    const status = /Invalid athlete profile/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
