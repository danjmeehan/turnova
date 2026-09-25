import {
  applyGarminWatchToProfile,
  loadAthleteProfile,
  saveAthleteProfile,
} from "@/lib/athlete-profile";
import { GarminApi, pickPrimaryWatchName } from "@/lib/garmin/client";
import { syncGarminGear } from "@/lib/garmin/gear";
import {
  getGarminStatus,
  getStoredGarminTokens,
  saveGarminTokens,
  setGarminSyncMeta,
} from "@/lib/garmin/tokens";
import { upsertTelemetry } from "@/lib/telemetry";
import { addDays, todayDateKey } from "@/lib/week";

const STALE_MS = 6 * 60 * 60 * 1000;
const QUIET_TIMEOUT_MS = 20_000;
const DAY_CONCURRENCY = 3;

export type GarminSyncResult = {
  ok: boolean;
  upserted: number;
  skipped: number;
  gearCount: number;
  lastSyncedAt: string | null;
  error?: string;
};

export type QuietGarminSync = {
  attempted: boolean;
  ok: boolean;
  error?: string;
};

function hasSleepOrHrv(day: {
  overnightHrv: number | null;
  sleepScore: number | null;
  sleepHours: number | null;
}): boolean {
  return (
    day.overnightHrv != null || day.sleepScore != null || day.sleepHours != null
  );
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export async function syncRecentGarmin(
  days = 14,
): Promise<GarminSyncResult> {
  const stored = await getStoredGarminTokens();
  if (!stored) {
    return {
      ok: false,
      upserted: 0,
      skipped: 0,
      gearCount: 0,
      lastSyncedAt: null,
      error: "Garmin not connected.",
    };
  }

  const api = new GarminApi(stored, async (tokens) => {
    await saveGarminTokens({ tokens });
  });

  let displayName: string | null = null;
  let userProfilePk: number | null = null;
  try {
    const identity = await api.getSocialIdentity();
    displayName = identity.displayName;
    userProfilePk = identity.userProfilePk;
    if (displayName || userProfilePk != null) {
      await saveGarminTokens({
        tokens: api.tokens,
        displayName,
        userProfilePk,
      });
    }
  } catch {
    displayName = null;
  }

  const end = todayDateKey();
  const dates = Array.from({ length: days }, (_, i) =>
    addDays(end, -(days - 1 - i)),
  );

  try {
    const outcomes = await mapPool(dates, DAY_CONCURRENCY, async (date) => {
      const day = await api.getDayWellness(date, displayName);
      if (!hasSleepOrHrv(day)) return "skipped" as const;
      await upsertTelemetry({
        date,
        overnight_hrv: day.overnightHrv,
        sleep_score: day.sleepScore,
        sleep_hours: day.sleepHours,
        resting_hr: day.restingHr,
        stress: day.stress,
        source: "garmin",
      });
      return "upserted" as const;
    });

    const upserted = outcomes.filter((o) => o === "upserted").length;
    const skipped = outcomes.filter((o) => o === "skipped").length;
    let gearCount = 0;
    try {
      if (userProfilePk != null) {
        gearCount = await syncGarminGear(api, userProfilePk);
      }
    } catch (err) {
      console.error(
        "[garmin/sync] gear locker failed",
        err instanceof Error ? err.message : err,
      );
    }
    try {
      const devices = await api.getDevices();
      const watchName = pickPrimaryWatchName(devices);
      if (watchName) {
        const profile = loadAthleteProfile();
        saveAthleteProfile(applyGarminWatchToProfile(profile, watchName));
      }
    } catch (err) {
      console.error(
        "[garmin/sync] devices failed",
        err instanceof Error ? err.message : err,
      );
    }
    const lastSyncedAt = new Date();
    await setGarminSyncMeta({ lastSyncedAt, lastError: null });
    return {
      ok: true,
      upserted,
      skipped,
      gearCount,
      lastSyncedAt: lastSyncedAt.toISOString(),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Garmin sync failed";
    await setGarminSyncMeta({ lastError: error });
    return {
      ok: false,
      upserted: 0,
      skipped: 0,
      gearCount: 0,
      lastSyncedAt: null,
      error,
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Garmin sync timed out"));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

let quietInFlight: Promise<QuietGarminSync> | null = null;

async function quietSyncInner(): Promise<QuietGarminSync> {
  const status = await getGarminStatus();
  if (!status.connected) {
    return { attempted: false, ok: true };
  }
  if (status.lastSyncedAt) {
    const age = Date.now() - new Date(status.lastSyncedAt).getTime();
    if (Number.isFinite(age) && age < STALE_MS) {
      return { attempted: false, ok: true };
    }
  }

  try {
    const result = await withTimeout(syncRecentGarmin(14), QUIET_TIMEOUT_MS);
    if (!result.ok) {
      return { attempted: true, ok: false, error: result.error };
    }
    return { attempted: true, ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Garmin sync failed";
    await setGarminSyncMeta({ lastError: error });
    return { attempted: true, ok: false, error };
  }
}

/** Refresh Garmin if connected and last sync is older than ~6 hours. Soft-fail. */
export async function maybeQuietGarminSync(): Promise<QuietGarminSync> {
  if (quietInFlight) return quietInFlight;
  quietInFlight = quietSyncInner().finally(() => {
    quietInFlight = null;
  });
  return quietInFlight;
}

export function garminNoteFromQuiet(sync: QuietGarminSync): string | null {
  if (!sync.attempted || sync.ok) return null;
  return `Garmin refresh failed (${sync.error ?? "unknown error"}); using last stored recovery rows.`;
}
