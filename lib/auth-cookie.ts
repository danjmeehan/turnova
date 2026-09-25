/**
 * Edge-safe session cookie helpers for the single-user password gate.
 * Gate is off when APP_PASSWORD is unset (local dev).
 */

export const AUTH_COOKIE = "turnova_session";

const SESSION_PAYLOAD = "turnova-ok";

export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD?.trim());
}

function signingSecret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.APP_PASSWORD?.trim() ||
    ""
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(message: string): Promise<string> {
  const secret = signingSecret();
  if (!secret) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return toHex(sig);
}

export async function createSessionToken(): Promise<string> {
  return hmacHex(SESSION_PAYLOAD);
}

export async function isValidSessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const expected = await createSessionToken();
  if (!expected || token.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export function passwordMatches(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD?.trim() ?? "";
  if (!expected || candidate.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < candidate.length; i++) {
    mismatch |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
