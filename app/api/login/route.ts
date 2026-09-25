import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  createSessionToken,
  isAuthEnabled,
  passwordMatches,
} from "@/lib/auth-cookie";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let password = "";
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as { password?: string };
    password = typeof body.password === "string" ? body.password : "";
  } else {
    const form = await req.formData().catch(() => null);
    const value = form?.get("password");
    password = typeof value === "string" ? value : "";
  }

  if (!passwordMatches(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await createSessionToken();
  const next = req.nextUrl.searchParams.get("next") || "/";
  const redirectTo = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const wantsJson = contentType.includes("application/json");
  const res = wantsJson
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL(redirectTo, req.url));

  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
