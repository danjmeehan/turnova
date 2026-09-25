import { prisma } from "@/lib/db";
import { assertStravaConfig } from "@/lib/strava/config";
import {
  canMakeReadRequest,
  nextFifteenMinuteReset,
  parseRateLimitHeaders,
  StravaRateLimitError,
  type RateLimitSnapshot,
} from "@/lib/strava/rate-limit";

const TOKEN_ID = "default";
const SYNC_ID = "default";

export type StravaTokenRecord = {
  athleteId: number;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string | null;
};

type TokenResponse = {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  athlete?: { id: number };
};

export async function getStoredStravaToken(): Promise<StravaTokenRecord | null> {
  const row = await prisma.stravaToken.findUnique({ where: { id: TOKEN_ID } });
  if (!row) return null;
  return {
    athleteId: row.athleteId,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt,
    scope: row.scope,
  };
}

export async function saveStravaToken(input: {
  athleteId: number;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope?: string | null;
}): Promise<void> {
  await prisma.stravaToken.upsert({
    where: { id: TOKEN_ID },
    create: {
      id: TOKEN_ID,
      athleteId: input.athleteId,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiresAt: input.expiresAt,
      scope: input.scope ?? null,
    },
    update: {
      athleteId: input.athleteId,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiresAt: input.expiresAt,
      scope: input.scope ?? null,
    },
  });
}

export async function exchangeStravaCode(
  code: string,
  grantedScope?: string | null,
): Promise<StravaTokenRecord> {
  const { clientId, clientSecret } = assertStravaConfig();
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Strava token exchange failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as TokenResponse & { scope?: string };
  if (!data.athlete?.id) {
    throw new Error("Strava token response missing athlete id");
  }
  const record: StravaTokenRecord = {
    athleteId: data.athlete.id,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at * 1000),
    scope: grantedScope ?? data.scope ?? null,
  };
  await saveStravaToken(record);
  return record;
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<StravaTokenRecord> {
  const { clientId, clientSecret } = assertStravaConfig();
  const existing = await getStoredStravaToken();
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Strava token refresh failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as TokenResponse;
  const athleteId = data.athlete?.id ?? existing?.athleteId;
  if (!athleteId) {
    throw new Error("Strava refresh response missing athlete id");
  }
  const record: StravaTokenRecord = {
    athleteId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at * 1000),
    scope: existing?.scope ?? null,
  };
  await saveStravaToken(record);
  return record;
}

export async function getValidAccessToken(): Promise<string> {
  const token = await getStoredStravaToken();
  if (!token) {
    throw new Error("Strava not connected. Visit Connect Strava first.");
  }
  const skewMs = 60_000;
  if (token.expiresAt.getTime() > Date.now() + skewMs) {
    return token.accessToken;
  }
  const refreshed = await refreshAccessToken(token.refreshToken);
  return refreshed.accessToken;
}

async function loadRateSnapshot(): Promise<RateLimitSnapshot | null> {
  const state = await prisma.stravaSyncState.findUnique({ where: { id: SYNC_ID } });
  if (!state?.rateLimitJson) return null;
  return state.rateLimitJson as unknown as RateLimitSnapshot;
}

async function saveRateSnapshot(snap: RateLimitSnapshot, retryAt?: Date | null) {
  await prisma.stravaSyncState.upsert({
    where: { id: SYNC_ID },
    create: {
      id: SYNC_ID,
      rateLimitJson: snap as object,
      rateLimitedUntil: retryAt ?? null,
    },
    update: {
      rateLimitJson: snap as object,
      ...(retryAt !== undefined ? { rateLimitedUntil: retryAt } : {}),
    },
  });
}

/**
 * Authenticated Strava GET/POST that tracks rate-limit headers and
 * refuses to fire when local budget says we should wait.
 */
export async function stravaFetch<T>(
  path: string,
  init?: RequestInit,
  options?: { ignoreBudget?: boolean },
): Promise<T> {
  const previous = await loadRateSnapshot();
  if (!options?.ignoreBudget) {
    const budget = canMakeReadRequest(previous);
    if (!budget.ok) {
      throw new StravaRateLimitError(
        `Strava rate budget exhausted (${budget.reason}). Retry after ${budget.retryAt.toISOString()}`,
        budget.retryAt,
      );
    }
  }

  const accessToken = await getValidAccessToken();
  const url = path.startsWith("http")
    ? path
    : `https://www.strava.com/api/v3${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });

  const snap = parseRateLimitHeaders(res.headers, previous);
  await saveRateSnapshot(snap);

  if (res.status === 429) {
    const retryAt = nextFifteenMinuteReset();
    await saveRateSnapshot(snap, retryAt);
    const body = await res.text();
    throw new StravaRateLimitError(
      `Strava 429 Too Many Requests: ${body}`,
      retryAt,
      429,
    );
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Strava API ${path} failed (${res.status}): ${body}`);
  }
  return (await res.json()) as T;
}

export async function getRateLimitStatus(): Promise<{
  snapshot: RateLimitSnapshot | null;
  budget: ReturnType<typeof canMakeReadRequest>;
  rateLimitedUntil: string | null;
}> {
  const state = await prisma.stravaSyncState.findUnique({ where: { id: SYNC_ID } });
  const snapshot = (state?.rateLimitJson as unknown as RateLimitSnapshot) ?? null;
  return {
    snapshot,
    budget: canMakeReadRequest(snapshot),
    rateLimitedUntil: state?.rateLimitedUntil?.toISOString() ?? null,
  };
}
