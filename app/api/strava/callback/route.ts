import { NextRequest, NextResponse } from "next/server";
import { exchangeStravaCode } from "@/lib/strava/auth";
import { runStravaSyncChunk } from "@/lib/strava/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const err = url.searchParams.get("error");
  if (err) {
    return NextResponse.redirect(
      new URL(`/?strava=error&message=${encodeURIComponent(err)}`, url.origin),
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = req.cookies.get("strava_oauth_state")?.value;

  if (!code) {
    return NextResponse.redirect(
      new URL("/?strava=error&message=missing_code", url.origin),
    );
  }
  if (!state || !expected || state !== expected) {
    return NextResponse.redirect(
      new URL("/?strava=error&message=invalid_state", url.origin),
    );
  }

  try {
    await exchangeStravaCode(code, url.searchParams.get("scope"));
    // Light first chunk only — full history via Auto-backfill / npm run strava:backfill
    await runStravaSyncChunk({ refreshGear: true, maxRequests: 5 });
    const res = NextResponse.redirect(new URL("/?strava=connected", url.origin));
    res.cookies.set("strava_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "oauth_failed";
    console.error("[strava/callback]", e);
    return NextResponse.redirect(
      new URL(
        `/?strava=error&message=${encodeURIComponent(message.slice(0, 200))}`,
        url.origin,
      ),
    );
  }
}
