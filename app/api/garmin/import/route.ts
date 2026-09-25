import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GarminApi, type GarminStoredTokens } from "@/lib/garmin/client";
import { saveGarminTokens } from "@/lib/garmin/tokens";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  oauth1: z.object({
    oauth_token: z.string().min(1),
    oauth_token_secret: z.string().min(1),
    mfa_token: z.string().optional(),
  }),
  oauth2: z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_in: z.number().optional(),
    expires_at: z.number().optional(),
    refresh_token_expires_in: z.number().optional(),
    token_type: z.string().optional(),
    scope: z.string().optional(),
  }),
  displayName: z.string().nullable().optional(),
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
      { error: "oauth1 and oauth2 tokens are required." },
      { status: 400 },
    );
  }

  const tokens: GarminStoredTokens = {
    oauth1: parsed.data.oauth1,
    oauth2: parsed.data.oauth2,
  };
  const api = new GarminApi(tokens);
  let displayName = parsed.data.displayName ?? null;
  try {
    displayName = (await api.getDisplayName()) ?? displayName;
  } catch {
    // Keep caller-supplied name if live profile fetch fails.
  }

  await saveGarminTokens({
    tokens: api.tokens,
    displayName,
    lastError: null,
    clearPendingMfa: true,
  });
  return NextResponse.json({
    connected: true,
    displayName,
  });
}
