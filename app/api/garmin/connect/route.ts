import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GarminAuthError, loginGarmin } from "@/lib/garmin/client";
import { saveGarminPendingMfa, saveGarminTokens } from "@/lib/garmin/tokens";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  try {
    const result = await loginGarmin(parsed.data.email, parsed.data.password);
    if (!result.ok) {
      await saveGarminPendingMfa(result.pending);
      return NextResponse.json({ mfaRequired: true });
    }
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
          : "Garmin login failed";
    console.error("[garmin/connect]", message);
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
