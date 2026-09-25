/**
 * Env helpers — normalize keys from .env.local (no surrounding quotes/whitespace).
 */

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Vercel AI SDK (@ai-sdk/google) reads GOOGLE_GENERATIVE_AI_API_KEY by default.
 * We resolve + sanitize explicitly so quoted/trailing-space values still work.
 */
export function getGoogleGenerativeAiApiKey(): string | undefined {
  const raw = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (raw == null || raw === "") return undefined;
  const key = stripWrappingQuotes(raw);
  return key.length > 0 ? key : undefined;
}

export function getWeatherApiKey(): string | undefined {
  const raw = process.env.WEATHERAPI_KEY;
  if (raw == null || raw === "") return undefined;
  const key = stripWrappingQuotes(raw);
  return key.length > 0 ? key : undefined;
}

export function assertGoogleGenerativeAiApiKey(): string {
  const key = getGoogleGenerativeAiApiKey();
  if (!key) {
    throw new Error(
      "Missing GOOGLE_GENERATIVE_AI_API_KEY. Set it in .env.local (no quotes), then restart the process. Get a key at https://aistudio.google.com/apikey",
    );
  }
  if (key.includes("your_gemini_api_key") || key.startsWith("your_")) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is still the placeholder. Replace it with a real API key from https://aistudio.google.com/apikey",
    );
  }
  return key;
}
