/**
 * Strava Standard Developer Tier rate limits (read / non-upload endpoints).
 * Source: https://developers.strava.com/docs/rate-limits/
 *
 * Standard Tier (self-upgraded, up to 10 athletes):
 *   Read: 200 / 15 min, 2,000 / day
 *   Overall: 400 / 15 min, 4,000 / day
 *
 * Default / single-player apps may still see lower read caps (100 / 15 min, 1,000 / day).
 * Override via env if your dashboard shows different limits.
 */

export type RateLimitSnapshot = {
  /** 15-minute overall usage */
  overall15m: number;
  overallDaily: number;
  overall15mLimit: number;
  overallDailyLimit: number;
  /** 15-minute read (non-upload) usage — this is what activity list hits */
  read15m: number;
  readDaily: number;
  read15mLimit: number;
  readDailyLimit: number;
  updatedAt: string;
};

export class StravaRateLimitError extends Error {
  readonly retryAt: Date;
  readonly status: number;

  constructor(message: string, retryAt: Date, status = 429) {
    super(message);
    this.name = "StravaRateLimitError";
    this.retryAt = retryAt;
    this.status = status;
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Configured Standard Tier read limits (overridable). */
export function getStravaRateLimitConfig() {
  return {
    // Prefer Standard Tier upgraded read limits; override if dashboard differs
    read15mLimit: envInt("STRAVA_READ_LIMIT_15M", 200),
    readDailyLimit: envInt("STRAVA_READ_LIMIT_DAILY", 2000),
    overall15mLimit: envInt("STRAVA_OVERALL_LIMIT_15M", 400),
    overallDailyLimit: envInt("STRAVA_OVERALL_LIMIT_DAILY", 4000),
    /** Stop a chunk this many requests before hitting the ceiling */
    headroom: envInt("STRAVA_RATE_HEADROOM", 15),
  };
}

/** Next Strava 15-minute window boundary (UTC :00/:15/:30/:45) + small buffer. */
export function nextFifteenMinuteReset(nowMs = Date.now()): Date {
  const d = new Date(nowMs);
  const mins = d.getUTCMinutes();
  const slot = Math.floor(mins / 15);
  const next = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    (slot + 1) * 15,
    1,
    0,
  ));
  // Handle hour overflow when slot is 3 (45) → next hour :00
  if ((slot + 1) * 15 >= 60) {
    return new Date(Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours() + 1,
      0,
      1,
      0,
    ));
  }
  return next;
}

/** Next daily reset (midnight UTC) + buffer. */
export function nextDailyReset(nowMs = Date.now()): Date {
  const d = new Date(nowMs);
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0,
    0,
    5,
    0,
  ));
}

function parsePair(header: string | null): { a: number; b: number } | null {
  if (!header) return null;
  const parts = header.split(",").map((p) => Number(p.trim()));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return { a: parts[0], b: parts[1] };
}

export function parseRateLimitHeaders(
  headers: Headers,
  previous?: RateLimitSnapshot | null,
): RateLimitSnapshot {
  const cfg = getStravaRateLimitConfig();
  const usage = parsePair(headers.get("X-RateLimit-Usage"));
  const limit = parsePair(headers.get("X-RateLimit-Limit"));
  const readUsage = parsePair(headers.get("X-ReadRateLimit-Usage"));
  const readLimit = parsePair(headers.get("X-ReadRateLimit-Limit"));

  return {
    overall15m: usage?.a ?? previous?.overall15m ?? 0,
    overallDaily: usage?.b ?? previous?.overallDaily ?? 0,
    overall15mLimit: limit?.a ?? previous?.overall15mLimit ?? cfg.overall15mLimit,
    overallDailyLimit: limit?.b ?? previous?.overallDailyLimit ?? cfg.overallDailyLimit,
    read15m: readUsage?.a ?? previous?.read15m ?? 0,
    readDaily: readUsage?.b ?? previous?.readDaily ?? 0,
    read15mLimit: readLimit?.a ?? previous?.read15mLimit ?? cfg.read15mLimit,
    readDailyLimit: readLimit?.b ?? previous?.readDailyLimit ?? cfg.readDailyLimit,
    updatedAt: new Date().toISOString(),
  };
}

export type BudgetDecision =
  | { ok: true; remaining15m: number; remainingDaily: number }
  | { ok: false; reason: "15m" | "daily"; retryAt: Date; remaining15m: number; remainingDaily: number };

/** Whether we can safely make another read request under configured headroom. */
export function canMakeReadRequest(snap: RateLimitSnapshot | null): BudgetDecision {
  const cfg = getStravaRateLimitConfig();
  const read15mLimit = snap?.read15mLimit ?? cfg.read15mLimit;
  const readDailyLimit = snap?.readDailyLimit ?? cfg.readDailyLimit;
  const overall15mLimit = snap?.overall15mLimit ?? cfg.overall15mLimit;
  const overallDailyLimit = snap?.overallDailyLimit ?? cfg.overallDailyLimit;

  const read15m = snap?.read15m ?? 0;
  const readDaily = snap?.readDaily ?? 0;
  const overall15m = snap?.overall15m ?? 0;
  const overallDaily = snap?.overallDaily ?? 0;

  const remainingRead15m = read15mLimit - read15m;
  const remainingReadDaily = readDailyLimit - readDaily;
  const remainingOverall15m = overall15mLimit - overall15m;
  const remainingOverallDaily = overallDailyLimit - overallDaily;

  const remaining15m = Math.min(remainingRead15m, remainingOverall15m);
  const remainingDaily = Math.min(remainingReadDaily, remainingOverallDaily);

  if (remainingDaily <= cfg.headroom) {
    return {
      ok: false,
      reason: "daily",
      retryAt: nextDailyReset(),
      remaining15m,
      remainingDaily,
    };
  }
  if (remaining15m <= cfg.headroom) {
    return {
      ok: false,
      reason: "15m",
      retryAt: nextFifteenMinuteReset(),
      remaining15m,
      remainingDaily,
    };
  }
  return { ok: true, remaining15m, remainingDaily };
}
