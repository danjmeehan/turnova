/**
 * Standalone Gemini auth + stream smoke test via Vercel AI SDK (@ai-sdk/google).
 *
 * Usage: npm run test:gemini
 * Requires GOOGLE_GENERATIVE_AI_API_KEY in .env.local or environment.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText } from "ai";

function loadEnvFile(filePath: string, override: boolean) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value.trim();
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// Load Next-style env files (local overrides default); strip surrounding quotes.
loadEnvFile(resolve(process.cwd(), ".env"), false);
loadEnvFile(resolve(process.cwd(), ".env.local"), true);

function getApiKey(): string {
  const raw = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!raw) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
  }
  const key = raw.trim();
  if (!key) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is empty after trim");
  return key;
}

async function main() {
  const apiKey = getApiKey();
  console.log(
    `Key loaded: prefix=${apiKey.slice(0, 2)}… length=${apiKey.length} (quotes/whitespace stripped)`,
  );

  const google = createGoogleGenerativeAI({ apiKey });

  console.log('Sending prompt: "Hello" via gemini-flash-latest (streaming)…');

  const result = streamText({
    model: google("gemini-flash-latest"),
    prompt: "Hello",
  });

  let text = "";
  process.stdout.write("Stream: ");
  try {
    for await (const delta of result.textStream) {
      process.stdout.write(delta);
      text += delta;
    }
  } catch (err) {
    process.stdout.write("\n");
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini stream failed: ${msg}`);
  }
  process.stdout.write("\n");

  if (!text.trim()) {
    throw new Error("Empty response from Gemini");
  }

  console.log("OK — Gemini authenticated and returned a streaming response.");
}

main().catch((err) => {
  console.error("FAIL —", err instanceof Error ? err.message : err);
  process.exit(1);
});
