import { NextResponse } from "next/server";
import { isAuthEnabled } from "@/lib/auth-cookie";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ enabled: isAuthEnabled() });
}
