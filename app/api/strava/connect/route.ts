import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { buildStravaAuthorizeUrl, getStravaConfig } from "@/lib/strava/config";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { clientId } = getStravaConfig();
    if (!clientId) {
      return NextResponse.json(
        {
          error:
            "STRAVA_CLIENT_ID not set. Create an app at https://www.strava.com/settings/api and add credentials to .env.local",
        },
        { status: 500 },
      );
    }
    const state = randomBytes(16).toString("hex");
    const url = buildStravaAuthorizeUrl(state);
    const res = NextResponse.redirect(url);
    res.cookies.set("strava_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
