import { prisma } from "@/lib/db";
import { coachSplitsFromRawDetail } from "@/lib/strava/details";
import { classifyActivityKind } from "@/lib/strava/types";

function metersToMiles(m: number | null | undefined): number | null {
  if (m == null) return null;
  return Math.round((m / 1609.344) * 100) / 100;
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

function hoursFromSec(sec: number | null | undefined): number | null {
  if (sec == null) return null;
  return Math.round((sec / 3600) * 100) / 100;
}

function formatDuration(sec: number | null | undefined): string | null {
  if (sec == null || sec < 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export type StravaContextPayload = {
  connected: boolean;
  sync: {
    backfillComplete: boolean;
    lastSyncedAt: string | null;
    activitiesSynced: number;
    lastError: string | null;
    recentMissingSplits: number;
  } | null;
  summary: {
    activityCount: number;
    dateRange: { from: string | null; to: string | null };
    bySportType: Record<string, { count: number; miles: number }>;
    raceCount: number;
    workoutCount: number;
  } | null;
  gearUsage: Array<{
    id: string;
    name: string;
    gearType: string;
    brandName: string | null;
    modelName: string | null;
    retired: boolean;
    stravaReportedMiles: number;
    activityMiles: number;
    activityCount: number;
  }>;
  /** Recent activities (newest first) with mile splits / laps when fetched. */
  recentActivities: Array<{
    id: string;
    date: string;
    name: string;
    sportType: string;
    kindLabel: string;
    isRace: boolean;
    isTrainer: boolean;
    miles: number | null;
    movingHours: number | null;
    pace: string | null;
    elevationM: number | null;
    avgHr: number | null;
    maxHr: number | null;
    cadence: number | null;
    gearName: string | null;
    description: string | null;
    hasDetail: boolean;
    mileSplits: Array<{
      n: number;
      miles: number;
      pace: string | null;
      elevM: number | null;
      avgHr: number | null;
    }>;
    laps: Array<{
      n: number;
      name: string | null;
      miles: number | null;
      movingSec: number | null;
      pace: string | null;
      avgHr: number | null;
      maxHr: number | null;
      avgCadence: number | null;
    }>;
  }>;
  /**
   * Complete race list (all isRace activities). Always injected in full —
   * races are sparse and must not depend on recent/sample windows.
   */
  races: Array<{
    id: string;
    date: string;
    name: string;
    sportType: string;
    miles: number | null;
    movingTime: string | null;
    pace: string | null;
    elevationM: number | null;
    avgHr: number | null;
    hasDetail: boolean;
  }>;
  /** Older history compressed for prompt size (no splits). */
  olderHistorySample: Array<{
    date: string;
    name: string;
    sportType: string;
    kindLabel: string;
    miles: number | null;
    pace: string | null;
    isRace: boolean;
  }>;
};

const RECENT_LIMIT = 40;
const OLDER_SAMPLE = 60;

export async function buildStravaContextPayload(): Promise<StravaContextPayload> {
  const token = await prisma.stravaToken.findUnique({ where: { id: "default" } });
  const sync = await prisma.stravaSyncState.findUnique({ where: { id: "default" } });

  if (!token) {
    return {
      connected: false,
      sync: null,
      summary: null,
      gearUsage: [],
      races: [],
      recentActivities: [],
      olderHistorySample: [],
    };
  }

  const [count, oldest, newest, activities, gear] = await Promise.all([
    prisma.stravaActivity.count(),
    prisma.stravaActivity.findFirst({ orderBy: { startDate: "asc" } }),
    prisma.stravaActivity.findFirst({ orderBy: { startDate: "desc" } }),
    prisma.stravaActivity.findMany({
      orderBy: { startDate: "desc" },
      include: { gear: true },
    }),
    prisma.stravaGear.findMany({ orderBy: { distanceMeters: "desc" } }),
  ]);

  const bySportType: Record<string, { count: number; miles: number }> = {};
  let raceCount = 0;
  let workoutCount = 0;
  const gearActivityMiles = new Map<string, { miles: number; count: number }>();

  for (const a of activities) {
    const miles = metersToMiles(a.distanceMeters) ?? 0;
    const key = a.sportType;
    if (!bySportType[key]) bySportType[key] = { count: 0, miles: 0 };
    bySportType[key].count += 1;
    bySportType[key].miles += miles;
    if (a.isRace) raceCount += 1;
    if (a.workoutType === 3) workoutCount += 1;
    if (a.gearId) {
      const g = gearActivityMiles.get(a.gearId) ?? { miles: 0, count: 0 };
      g.miles += miles;
      g.count += 1;
      gearActivityMiles.set(a.gearId, g);
    }
  }

  for (const key of Object.keys(bySportType)) {
    bySportType[key].miles = Math.round(bySportType[key].miles * 10) / 10;
  }

  const recentSlice = activities.slice(0, RECENT_LIMIT);
  let recentMissingSplits = 0;

  const recentActivities = recentSlice.map((a) => {
    const { kindLabel } = classifyActivityKind({
      sportType: a.sportType,
      workoutType: a.workoutType,
      name: a.name,
    });
    const hasDetail = Boolean(a.detailFetchedAt && a.rawDetail);
    if (!hasDetail) recentMissingSplits += 1;
    const { mileSplits, laps } = hasDetail
      ? coachSplitsFromRawDetail(a.rawDetail)
      : { mileSplits: [], laps: [] };

    return {
      id: a.id.toString(),
      date: a.startDate.toISOString().slice(0, 10),
      name: a.name,
      sportType: a.sportType,
      kindLabel,
      isRace: a.isRace,
      isTrainer: a.isTrainer,
      miles: metersToMiles(a.distanceMeters),
      movingHours: hoursFromSec(a.movingTimeSec),
      pace: formatPace(a.distanceMeters, a.movingTimeSec),
      elevationM: a.totalElevationGain,
      avgHr: a.averageHeartrate,
      maxHr: a.maxHeartrate,
      cadence: a.averageCadence,
      gearName: a.gear?.nickname || a.gear?.name || null,
      description: a.description,
      hasDetail,
      mileSplits,
      laps,
    };
  });

  const older = activities.slice(RECENT_LIMIT);
  const olderHistorySample: StravaContextPayload["olderHistorySample"] = [];
  if (older.length > 0) {
    const step = Math.max(1, Math.floor(older.length / OLDER_SAMPLE));
    for (let i = 0; i < older.length && olderHistorySample.length < OLDER_SAMPLE; i += step) {
      const a = older[i];
      const { kindLabel } = classifyActivityKind({
        sportType: a.sportType,
        workoutType: a.workoutType,
        name: a.name,
      });
      olderHistorySample.push({
        date: a.startDate.toISOString().slice(0, 10),
        name: a.name,
        sportType: a.sportType,
        kindLabel,
        miles: metersToMiles(a.distanceMeters),
        pace: formatPace(a.distanceMeters, a.movingTimeSec),
        isRace: a.isRace,
      });
    }
  }

  const gearUsage = gear.map((g) => {
    const fromActs = gearActivityMiles.get(g.id) ?? { miles: 0, count: 0 };
    return {
      id: g.id,
      name: g.nickname || g.name,
      gearType: g.gearType,
      brandName: g.brandName,
      modelName: g.modelName,
      retired: g.retired,
      stravaReportedMiles: metersToMiles(g.distanceMeters) ?? 0,
      activityMiles: Math.round(fromActs.miles * 10) / 10,
      activityCount: fromActs.count,
    };
  });

  // Full race catalog — do not sample. Newest first.
  const races = activities
    .filter((a) => a.isRace)
    .map((a) => ({
      id: a.id.toString(),
      date: a.startDate.toISOString().slice(0, 10),
      name: a.name,
      sportType: a.sportType,
      miles: metersToMiles(a.distanceMeters),
      movingTime: formatDuration(a.movingTimeSec),
      pace: formatPace(a.distanceMeters, a.movingTimeSec),
      elevationM: a.totalElevationGain,
      avgHr: a.averageHeartrate,
      hasDetail: Boolean(a.detailFetchedAt && a.rawDetail),
    }));

  return {
    connected: true,
    sync: sync
      ? {
          backfillComplete: sync.backfillComplete,
          lastSyncedAt: sync.lastSyncedAt?.toISOString() ?? null,
          activitiesSynced: sync.activitiesSynced,
          lastError: sync.lastError,
          recentMissingSplits,
        }
      : null,
    summary: {
      activityCount: count,
      dateRange: {
        from: oldest?.startDate.toISOString().slice(0, 10) ?? null,
        to: newest?.startDate.toISOString().slice(0, 10) ?? null,
      },
      bySportType,
      raceCount,
      workoutCount,
    },
    gearUsage,
    races,
    recentActivities,
    olderHistorySample,
  };
}
