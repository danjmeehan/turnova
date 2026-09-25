import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GarminAuthError, verifyGarminMfa } from "@/lib/garmin/client";
import { getGarminPendingMfa, saveGarminTokens } from "@/lib/garmin/tokens";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  code: z.string().min(4),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "MFA code is required." },
      { status: 400 },
    );
  }

  const pending = await getGarminPendingMfa();
  if (!pending) {
    return NextResponse.json(
      { error: "No Garmin MFA session. Connect again." },
      { status: 400 },
    );
  }

  try {
    const result = await verifyGarminMfa(pending, parsed.data.code);
    await saveGarminTokens({
      tokens: result.tokens,
      displayName: result.displayName,
      lastError: null,
      clearPendingMfa: true,
    });
    return NextResponse.json({
      connected: true,
      displayName: result.displayName,
    });
  } catch (err) {
    const message =
      err instanceof GarminAuthError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Garmin MFA failed";
    console.error("[garmin/mfa]", message);
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
