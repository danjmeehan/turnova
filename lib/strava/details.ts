import { prisma } from "@/lib/db";
import { stravaFetch } from "@/lib/strava/auth";
import {
  ensureGearPlaceholder,
  inferGearType,
  upsertGearRecord,
} from "@/lib/strava/gear";
import {
  canMakeReadRequest,
  StravaRateLimitError,
  type RateLimitSnapshot,
} from "@/lib/strava/rate-limit";
import type { StravaApiActivityDetail } from "@/lib/strava/types";

const SYNC_ID = "default";

export type CoachSplit = {
  n: number;
  miles: number;
  pace: string | null;
  elevM: number | null;
  avgHr: number | null;
};

export type CoachLap = {
  n: number;
  name: string | null;
  miles: number | null;
  movingSec: number | null;
  pace: string | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
};

function metersToMiles(m: number | null | undefined): number | null {
  if (m == null) return null;
  return Math.round((m / 1609.344) * 1000) / 1000;
}

function formatPace(
  distanceMeters?: number | null,
  movingSec?: number | null,
): string | null {
  if (!distanceMeters || !movingSec || distanceMeters <= 0) return null;
  const miles = distanceMeters / 1609.344;
  if (miles <= 0) return null;
  const secPerMile = movingSec / miles;
  const min = Math.floor(secPerMile / 60);
  const sec = Math.round(secPerMile % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/mi`;
}

/** Prefer imperial mile splits; fall back to converting metric km splits. */
export function extractCoachSplits(detail: StravaApiActivityDetail): {
  mileSplits: CoachSplit[];
  laps: CoachLap[];
  description: string | null;
} {
  const mileSplits: CoachSplit[] = [];

  if (detail.splits_standard?.length) {
    detail.splits_standard.forEach((s, i) => {
      mileSplits.push({
        n: s.split ?? i + 1,
        miles: metersToMiles(s.distance) ?? 0,
        pace: formatPace(s.distance, s.moving_time),
        elevM: s.elevation_difference ?? null,
        avgHr: s.average_heartrate ?? null,
      });
    });
  } else if (detail.splits_metric?.length) {
    // Convert each km split to approx mile-equivalent display still useful
    detail.splits_metric.forEach((s, i) => {
      mileSplits.push({
        n: s.split ?? i + 1,
        miles: metersToMiles(s.distance) ?? 0,
        pace: formatPace(s.distance, s.moving_time),
        elevM: s.elevation_difference ?? null,
        avgHr: s.average_heartrate ?? null,
      });
    });
  }

  const laps: CoachLap[] = (detail.laps ?? []).map((lap, i) => ({
    n: lap.lap_index ?? i + 1,
    name: lap.name ?? null,
    miles: metersToMiles(lap.distance),
    movingSec: lap.moving_time ?? null,
    pace: formatPace(lap.distance, lap.moving_time),
    avgHr: lap.average_heartrate ?? null,
    maxHr: lap.max_heartrate ?? null,
    avgCadence: lap.average_cadence ?? null,
  }));

  return {
    mileSplits,
    laps,
    description: detail.description ?? null,
  };
}

export async function fetchAndStoreActivityDetail(
  activityId: bigint | number | string,
): Promise<{ mileSplits: CoachSplit[]; laps: CoachLap[] }> {
  const id = typeof activityId === "bigint" ? activityId.toString() : String(activityId);
  const detail = await stravaFetch<StravaApiActivityDetail>(
    `/activities/${id}?include_all_efforts=false`,
  );
  const extracted = extractCoachSplits(detail);

  const gearId = detail.gear_id || detail.gear?.id || null;
  if (gearId) {
    if (detail.gear?.id) {
      await upsertGearRecord(detail.gear, inferGearType(gearId));
    } else {
      await ensureGearPlaceholder(gearId, { gearType: inferGearType(gearId) });
    }
  }

  await prisma.stravaActivity.update({
    where: { id: BigInt(id) },
    data: {
      description: detail.description ?? undefined,
      averageCadence: detail.average_cadence ?? undefined,
      calories: detail.calories ?? undefined,
      sufferScore: detail.suffer_score ?? undefined,
      rawDetail: detail as object,
      detailFetchedAt: new Date(),
      // Keep summary fields fresh if detail has them
      distanceMeters: detail.distance ?? undefined,
      movingTimeSec: detail.moving_time ?? undefined,
      elapsedTimeSec: detail.elapsed_time ?? undefined,
      averageHeartrate: detail.average_heartrate ?? undefined,
      maxHeartrate: detail.max_heartrate ?? undefined,
      ...(gearId ? { gearId } : {}),
    },
  });

  return { mileSplits: extracted.mileSplits, laps: extracted.laps };
}

/**
 * Fetch Strava detail (splits/laps) for activities missing rawDetail.
 * Prioritizes: workouts & races, then most recent. Rate-limit aware.
 */
export async function runDetailFetchChunk(options?: {
  maxRequests?: number;
  /** Only consider this many newest activities for detail backfill */
  recentWindow?: number;
}): Promise<{
  fetched: number;
  remainingWithoutDetail: number;
  paused: boolean;
  pauseReason: "15m" | "daily" | "429" | null;
  retryAt: string | null;
  rateLimit: RateLimitSnapshot | null;
}> {
  const maxRequests = options?.maxRequests ?? 30;
  const recentWindow = options?.recentWindow ?? 80;

  let fetched = 0;
  let paused = false;
  let pauseReason: "15m" | "daily" | "429" | null = null;
  let retryAt: string | null = null;

  const state = await prisma.stravaSyncState.findUnique({ where: { id: SYNC_ID } });
  if (state?.rateLimitedUntil && state.rateLimitedUntil.getTime() > Date.now()) {
    return {
      fetched: 0,
      remainingWithoutDetail: await countMissingDetails(recentWindow),
      paused: true,
      pauseReason: "15m",
      retryAt: state.rateLimitedUntil.toISOString(),
      rateLimit: (state.rateLimitJson as unknown as RateLimitSnapshot) ?? null,
    };
  }

  const recent = await prisma.stravaActivity.findMany({
    orderBy: { startDate: "desc" },
    take: recentWindow,
    select: {
      id: true,
      workoutType: true,
      isRace: true,
      detailFetchedAt: true,
      startDate: true,
    },
  });

  const missing = recent
    .filter((a) => !a.detailFetchedAt)
    .sort((a, b) => {
      // Workouts / races first, then recency (already mostly recent)
      const score = (x: typeof a) =>
        (x.isRace ? 2 : 0) + (x.workoutType === 3 ? 2 : 0) + (x.workoutType === 2 ? 1 : 0);
      return score(b) - score(a);
    });

  for (const activity of missing) {
    if (fetched >= maxRequests) break;

    const live = await prisma.stravaSyncState.findUnique({ where: { id: SYNC_ID } });
    const snap = (live?.rateLimitJson as unknown as RateLimitSnapshot) ?? null;
    const budget = canMakeReadRequest(snap);
    if (!budget.ok) {
      paused = true;
      pauseReason = budget.reason;
      retryAt = budget.retryAt.toISOString();
      await prisma.stravaSyncState.update({
        where: { id: SYNC_ID },
        data: { rateLimitedUntil: budget.retryAt },
      });
      break;
    }

    try {
      await fetchAndStoreActivityDetail(activity.id);
      fetched += 1;
    } catch (err) {
      if (err instanceof StravaRateLimitError) {
        paused = true;
        pauseReason = "429";
        retryAt = err.retryAt.toISOString();
        break;
      }
      throw err;
    }
  }

  const live = await prisma.stravaSyncState.findUnique({ where: { id: SYNC_ID } });
  return {
    fetched,
    remainingWithoutDetail: await countMissingDetails(recentWindow),
    paused,
    pauseReason,
    retryAt,
    rateLimit: (live?.rateLimitJson as unknown as RateLimitSnapshot) ?? null,
  };
}

async function countMissingDetails(recentWindow: number): Promise<number> {
  const recent = await prisma.stravaActivity.findMany({
    orderBy: { startDate: "desc" },
    take: recentWindow,
    select: { detailFetchedAt: true },
  });
  return recent.filter((a) => !a.detailFetchedAt).length;
}

export function coachSplitsFromRawDetail(raw: unknown): {
  mileSplits: CoachSplit[];
  laps: CoachLap[];
} {
  if (!raw || typeof raw !== "object") {
    return { mileSplits: [], laps: [] };
  }
  return extractCoachSplits(raw as StravaApiActivityDetail);
}
