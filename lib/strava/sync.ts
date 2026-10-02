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
import {
  classifyActivityKind,
  type StravaApiActivity,
  type StravaApiAthlete,
} from "@/lib/strava/types";
import { runDetailFetchChunk } from "@/lib/strava/details";

const SYNC_ID = "default";
const PAGE_SIZE = 200;

async function upsertGearFromAthlete(athlete: StravaApiAthlete): Promise<number> {
  const items = [
    ...(athlete.shoes ?? []).map((g) => ({ g, gearType: "shoe" })),
    ...(athlete.bikes ?? []).map((g) => ({ g, gearType: "bike" })),
  ];

  for (const { g, gearType } of items) {
    await upsertGearRecord(g, gearType);
  }
  return items.length;
}

async function upsertActivity(a: StravaApiActivity): Promise<void> {
  const sportType = a.sport_type || a.type || "Unknown";
  const workoutType = a.workout_type ?? null;
  const { isRace } = classifyActivityKind({
    sportType,
    workoutType,
    name: a.name,
  });

  const gearId = a.gear_id || null;
  if (gearId) {
    await ensureGearPlaceholder(gearId, { gearType: inferGearType(gearId) });
  }

  const startDate = new Date(a.start_date || a.start_date_local || Date.now());

  await prisma.stravaActivity.upsert({
    where: { id: BigInt(a.id) },
    create: {
      id: BigInt(a.id),
      athleteId: a.athlete?.id ?? 0,
      name: a.name,
      sportType,
      type: a.type ?? null,
      workoutType,
      isRace,
      isTrainer: Boolean(a.trainer),
      isCommute: Boolean(a.commute),
      startDate,
      timezone: a.timezone ?? null,
      distanceMeters: a.distance ?? null,
      movingTimeSec: a.moving_time ?? null,
      elapsedTimeSec: a.elapsed_time ?? null,
      totalElevationGain: a.total_elevation_gain ?? null,
      averageSpeedMps: a.average_speed ?? null,
      maxSpeedMps: a.max_speed ?? null,
      averageHeartrate: a.average_heartrate ?? null,
      maxHeartrate: a.max_heartrate ?? null,
      averageCadence: a.average_cadence ?? null,
      kilojoules: a.kilojoules ?? null,
      sufferScore: a.suffer_score ?? null,
      calories: a.calories ?? null,
      description: a.description ?? null,
      gearId,
      mapSummaryPolyline: a.map?.summary_polyline ?? null,
      rawSummary: a as object,
    },
    update: {
      name: a.name,
      sportType,
      type: a.type ?? null,
      workoutType,
      isRace,
      isTrainer: Boolean(a.trainer),
      isCommute: Boolean(a.commute),
      startDate,
      timezone: a.timezone ?? null,
      distanceMeters: a.distance ?? null,
      movingTimeSec: a.moving_time ?? null,
      elapsedTimeSec: a.elapsed_time ?? null,
      totalElevationGain: a.total_elevation_gain ?? null,
      averageSpeedMps: a.average_speed ?? null,
      maxSpeedMps: a.max_speed ?? null,
      averageHeartrate: a.average_heartrate ?? null,
      maxHeartrate: a.max_heartrate ?? null,
      averageCadence: a.average_cadence ?? null,
      kilojoules: a.kilojoules ?? null,
      sufferScore: a.suffer_score ?? null,
      calories: a.calories ?? null,
      description: a.description ?? null,
      gearId,
      mapSummaryPolyline: a.map?.summary_polyline ?? null,
      rawSummary: a as object,
    },
  });
}

export type ChunkResult = {
  mode: "backfill" | "incremental" | "details";
  gearUpserted: number;
  activitiesUpserted: number;
  detailsFetched: number;
  pagesFetched: number;
  requestsUsed: number;
  backfillComplete: boolean;
  totalActivities: number;
  recentMissingSplits: number;
  paused: boolean;
  pauseReason: "15m" | "daily" | "429" | null;
  retryAt: string | null;
  rateLimit: RateLimitSnapshot | null;
  autoBackfillEnabled: boolean;
};

async function getOrCreateState() {
  return prisma.stravaSyncState.upsert({
    where: { id: SYNC_ID },
    create: { id: SYNC_ID },
    update: {},
  });
}

/**
 * Run one rate-limit-aware sync chunk.
 * Backfill walks older history via `before=` cursor until budget runs out or history ends.
 * Incremental fetches activities after lastActivityStart.
 */
export async function runStravaSyncChunk(options?: {
  refreshGear?: boolean;
  /** Max API read calls this chunk (safety); budget usually stops sooner */
  maxRequests?: number;
}): Promise<ChunkResult> {
  const maxRequests = options?.maxRequests ?? 50;
  let gearUpserted = 0;
  let activitiesUpserted = 0;
  let pagesFetched = 0;
  let requestsUsed = 0;
  let paused = false;
  let pauseReason: ChunkResult["pauseReason"] = null;
  let retryAt: string | null = null;

  const state = await getOrCreateState();

  // Honor hard wait if we previously hit 429 / budget
  if (state.rateLimitedUntil && state.rateLimitedUntil.getTime() > Date.now()) {
    const snap = (state.rateLimitJson as unknown as RateLimitSnapshot) ?? null;
    const missing = await prisma.stravaActivity.count({
      where: {
        detailFetchedAt: null,
        startDate: {
          gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 180),
        },
      },
    });
    return {
      mode: state.backfillComplete ? "incremental" : "backfill",
      gearUpserted: 0,
      activitiesUpserted: 0,
      detailsFetched: 0,
      pagesFetched: 0,
      requestsUsed: 0,
      backfillComplete: state.backfillComplete,
      totalActivities: await prisma.stravaActivity.count(),
      recentMissingSplits: missing,
      paused: true,
      pauseReason: "15m",
      retryAt: state.rateLimitedUntil.toISOString(),
      rateLimit: snap,
      autoBackfillEnabled: state.autoBackfillEnabled,
    };
  }

  try {
    const shouldRefreshGear =
      options?.refreshGear === true ||
      (!state.backfillComplete && state.backfillBeforeEpoch == null);

    if (shouldRefreshGear) {
      const athlete = await stravaFetch<StravaApiAthlete>("/athlete");
      requestsUsed += 1;
      gearUpserted = await upsertGearFromAthlete(athlete);
    }

    const mode: "backfill" | "incremental" = state.backfillComplete
      ? "incremental"
      : "backfill";

    let newestStart: Date | null = state.lastActivityStart;
    let beforeEpoch =
      state.backfillBeforeEpoch ?? Math.floor(Date.now() / 1000);
    let backfillComplete = state.backfillComplete;

    if (mode === "backfill") {
      while (requestsUsed < maxRequests) {
        const live = await prisma.stravaSyncState.findUnique({
          where: { id: SYNC_ID },
        });
        const snap =
          (live?.rateLimitJson as unknown as RateLimitSnapshot) ?? null;
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

        const path = `/athlete/activities?before=${beforeEpoch}&per_page=${PAGE_SIZE}`;
        let batch: StravaApiActivity[];
        try {
          batch = await stravaFetch<StravaApiActivity[]>(path);
        } catch (err) {
          if (err instanceof StravaRateLimitError) {
            paused = true;
            pauseReason = "429";
            retryAt = err.retryAt.toISOString();
            break;
          }
          throw err;
        }
        requestsUsed += 1;
        pagesFetched += 1;

        if (!batch.length) {
          backfillComplete = true;
          beforeEpoch = beforeEpoch;
          break;
        }

        let oldest = beforeEpoch;
        for (const activity of batch) {
          await upsertActivity(activity);
          activitiesUpserted += 1;
          const start = new Date(
            activity.start_date || activity.start_date_local || Date.now(),
          );
          const startEpoch = Math.floor(start.getTime() / 1000);
          if (startEpoch < oldest) oldest = startEpoch;
          if (!newestStart || start > newestStart) newestStart = start;
        }

        // Walk strictly older than the oldest activity in this page
        beforeEpoch = oldest - 1;

        if (batch.length < PAGE_SIZE) {
          backfillComplete = true;
          break;
        }
      }
    } else {
      // Incremental: pages after last known activity
      const afterEpoch = Math.floor(
        ((state.lastActivityStart?.getTime() ?? 0) - 60_000) / 1000,
      );
      let page = 1;
      while (requestsUsed < maxRequests) {
        const live = await prisma.stravaSyncState.findUnique({
          where: { id: SYNC_ID },
        });
        const snap =
          (live?.rateLimitJson as unknown as RateLimitSnapshot) ?? null;
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

        const path = `/athlete/activities?page=${page}&per_page=${PAGE_SIZE}&after=${afterEpoch}`;
        let batch: StravaApiActivity[];
        try {
          batch = await stravaFetch<StravaApiActivity[]>(path);
        } catch (err) {
          if (err instanceof StravaRateLimitError) {
            paused = true;
            pauseReason = "429";
            retryAt = err.retryAt.toISOString();
            break;
          }
          throw err;
        }
        requestsUsed += 1;
        pagesFetched += 1;

        if (!batch.length) break;

        for (const activity of batch) {
          await upsertActivity(activity);
          activitiesUpserted += 1;
          const start = new Date(
            activity.start_date || activity.start_date_local || Date.now(),
          );
          if (!newestStart || start > newestStart) newestStart = start;
        }

        if (batch.length < PAGE_SIZE) break;
        page += 1;
      }
      backfillComplete = true;
    }

    // With remaining budget, pull per-activity splits/laps (workouts/races first).
    let detailsFetched = 0;
    if (!paused && requestsUsed < maxRequests) {
      const detailChunk = await runDetailFetchChunk({
        maxRequests: maxRequests - requestsUsed,
        recentWindow: 80,
      });
      detailsFetched = detailChunk.fetched;
      requestsUsed += detailChunk.fetched;
      if (detailChunk.paused) {
        paused = true;
        pauseReason = detailChunk.pauseReason;
        retryAt = detailChunk.retryAt;
      }
    }

    const totalActivities = await prisma.stravaActivity.count();
    const live = await prisma.stravaSyncState.findUnique({
      where: { id: SYNC_ID },
    });

    const [recentMissingRows, racesMissingDetail] = await Promise.all([
      prisma.stravaActivity.findMany({
        orderBy: { startDate: "desc" },
        take: 40,
        select: { detailFetchedAt: true },
      }),
      prisma.stravaActivity.count({
        where: { isRace: true, detailFetchedAt: null },
      }),
    ]);
    const recentMissingSplits =
      recentMissingRows.filter((a) => !a.detailFetchedAt).length +
      racesMissingDetail;

    await prisma.stravaSyncState.update({
      where: { id: SYNC_ID },
      data: {
        backfillComplete,
        backfillBeforeEpoch: backfillComplete ? null : beforeEpoch,
        lastActivityStart: newestStart ?? undefined,
        lastSyncedAt: new Date(),
        activitiesSynced: totalActivities,
        lastError: null,
        ...(paused ? {} : { rateLimitedUntil: null }),
        // Keep auto on until history AND recent splits are filled
        ...(backfillComplete && recentMissingSplits === 0
          ? { autoBackfillEnabled: false }
          : {}),
      },
    });

    return {
      mode: detailsFetched > 0 && activitiesUpserted === 0 ? "details" : mode,
      gearUpserted,
      activitiesUpserted,
      detailsFetched,
      pagesFetched,
      requestsUsed,
      backfillComplete,
      totalActivities,
      recentMissingSplits,
      paused,
      pauseReason,
      retryAt,
      rateLimit: (live?.rateLimitJson as unknown as RateLimitSnapshot) ?? null,
      autoBackfillEnabled: live?.autoBackfillEnabled ?? false,
    };
  } catch (err) {
    if (err instanceof StravaRateLimitError) {
      const totalActivities = await prisma.stravaActivity.count();
      const live = await prisma.stravaSyncState.findUnique({
        where: { id: SYNC_ID },
      });
      return {
        mode: state.backfillComplete ? "incremental" : "backfill",
        gearUpserted,
        activitiesUpserted,
        detailsFetched: 0,
        pagesFetched,
        requestsUsed,
        backfillComplete: state.backfillComplete,
        totalActivities,
        recentMissingSplits: 0,
        paused: true,
        pauseReason: "429",
        retryAt: err.retryAt.toISOString(),
        rateLimit: (live?.rateLimitJson as unknown as RateLimitSnapshot) ?? null,
        autoBackfillEnabled: live?.autoBackfillEnabled ?? false,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    await prisma.stravaSyncState.upsert({
      where: { id: SYNC_ID },
      create: { id: SYNC_ID, lastError: message },
      update: { lastError: message, lastSyncedAt: new Date() },
    });
    throw err;
  }
}

/** @deprecated Prefer runStravaSyncChunk — kept as alias for callers. */
export async function syncStravaActivities(options?: {
  maxPages?: number;
}): Promise<{
  gearUpserted: number;
  activitiesUpserted: number;
  pagesFetched: number;
  backfillComplete: boolean;
  totalActivities: number;
  mode: "backfill" | "incremental" | "details";
}> {
  const chunk = await runStravaSyncChunk({
    maxRequests: options?.maxPages ?? 50,
    refreshGear: true,
  });
  return {
    gearUpserted: chunk.gearUpserted,
    activitiesUpserted: chunk.activitiesUpserted,
    pagesFetched: chunk.pagesFetched,
    backfillComplete: chunk.backfillComplete,
    totalActivities: chunk.totalActivities,
    mode: chunk.mode,
  };
}

export async function setAutoBackfillEnabled(enabled: boolean): Promise<void> {
  await prisma.stravaSyncState.upsert({
    where: { id: SYNC_ID },
    create: { id: SYNC_ID, autoBackfillEnabled: enabled },
    update: { autoBackfillEnabled: enabled },
  });
}
