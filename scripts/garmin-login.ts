/**
 * Log in to Garmin from this machine (home IP), then optionally push
 * tokens to production. Use this when Connect Garmin on Fly returns UNKNOWN.
 *
 *   GARMIN_EMAIL=you@example.com GARMIN_PASSWORD='…' npm run garmin:login -- --push
 *
 * If Garmin asks for MFA, set GARMIN_MFA_CODE or type it when prompted.
 * --push uses APP_PASSWORD against TURNOVA_URL (default https://turnova.fly.dev).
 */

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import {
  loginGarmin,
  verifyGarminMfa,
  type GarminPendingMfa,
  type GarminStoredTokens,
} from "../lib/garmin/client";
import { saveGarminTokens } from "../lib/garmin/tokens";

function loadEnvFile(filePath: string, override: boolean) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim();
    }
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(process.cwd(), ".env"), false);
loadEnvFile(resolve(process.cwd(), ".env.local"), true);

function argFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function prompt(label: string, secret = false): Promise<string> {
  if (!input.isTTY) return "";
  const rl = createInterface({ input, output });
  try {
    if (secret && typeof rl.question === "function") {
      return (await rl.question(`${label}: `)).trim();
    }
    return (await rl.question(`${label}: `)).trim();
  } finally {
    rl.close();
  }
}

async function resolveMfa(pending: GarminPendingMfa): Promise<string> {
  const fromEnv = process.env.GARMIN_MFA_CODE?.trim() ?? "";
  if (fromEnv) return fromEnv;
  const typed = await prompt(`Garmin MFA code (${pending.mfaMethod})`);
  if (!typed) {
    throw new Error("Garmin MFA code was empty. Set GARMIN_MFA_CODE and retry.");
  }
  return typed;
}

async function pushToProduction(
  tokens: GarminStoredTokens,
  displayName: string | null,
): Promise<void> {
  const base = (process.env.TURNOVA_URL || "https://turnova.fly.dev").replace(
    /\/$/,
    "",
  );
  const password = process.env.APP_PASSWORD?.trim() ?? "";
  if (!password) {
    throw new Error("APP_PASSWORD is required to --push tokens to production.");
  }

  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    redirect: "manual",
  });
  const setCookies =
    typeof login.headers.getSetCookie === "function"
      ? login.headers.getSetCookie()
      : login.headers.get("set-cookie")
        ? [login.headers.get("set-cookie") as string]
        : [];
  if (!login.ok && login.status !== 302) {
    throw new Error(`Production login failed (HTTP ${login.status}).`);
  }
  const cookie = setCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) {
    throw new Error("Production login did not return a session cookie.");
  }

  const imported = await fetch(`${base}/api/garmin/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      oauth1: tokens.oauth1,
      oauth2: tokens.oauth2,
      displayName,
    }),
  });
  const body = (await imported.json().catch(() => ({}))) as {
    error?: string;
    connected?: boolean;
    displayName?: string | null;
  };
  if (!imported.ok) {
    throw new Error(body.error || `Import failed (HTTP ${imported.status}).`);
  }
  console.log(
    `Pushed Garmin session to ${base}` +
      (body.displayName ? ` (${body.displayName})` : "") +
      ".",
  );
}

async function main() {
  const email =
    process.env.GARMIN_EMAIL?.trim() || (await prompt("Garmin email"));
  const password =
    process.env.GARMIN_PASSWORD || (await prompt("Garmin password", true));
  if (!email || !password) {
    throw new Error("Set GARMIN_EMAIL and GARMIN_PASSWORD (or type them).");
  }

  console.log("Logging in to Garmin from this network…");
  let result = await loginGarmin(email, password);
  let tokens: GarminStoredTokens;
  let displayName: string | null;

  if (!result.ok) {
    console.log("Garmin requested MFA.");
    const code = await resolveMfa(result.pending);
    const verified = await verifyGarminMfa(result.pending, code);
    tokens = verified.tokens;
    displayName = verified.displayName;
  } else {
    tokens = result.tokens;
    displayName = result.displayName;
  }

  await saveGarminTokens({
    tokens,
    displayName,
    lastError: null,
    clearPendingMfa: true,
  });
  console.log(
    "Saved Garmin session locally" +
      (displayName ? ` (${displayName})` : "") +
      ".",
  );

  if (argFlag("--push")) {
    await pushToProduction(tokens, displayName);
  } else {
    console.log("Local only. Re-run with --push to copy this session to Fly.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
